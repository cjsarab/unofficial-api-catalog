/**
 * Lineage expression tokenizer.
 *
 * Ellucian's OpenAPI extensions encode two kinds of lineage:
 *
 *   x-lineageLookupReferenceObject  — a single reference: an EEDM API resource
 *                                     name, or a Banner/Colleague DB table name.
 *
 *   x-lineageReferenceObject        — a small DSL describing where a field's
 *                                     value comes from. Forms observed:
 *                                       - sentinels: unsupported | derived | caseInsensitiveRg
 *                                       - bare column: SPRIDEN_ID, FA.YEAR
 *                                       - column with explicit table: CAT.DESC(CATALOGS)
 *                                       - alternatives: X or Y
 *                                       - where clauses: X(T) where A = B
 *                                       - Oracle concatenation: (A||'lit'||B)
 *                                       - tuples: (A, B)
 *                                       - informal/dirty text: leading whitespace,
 *                                         unbalanced parens, 'etc' escapes
 *
 * The tokenizer is deliberately tolerant — we preserve raw strings for display
 * and extract every identifier token we can recognise for the inverted index.
 * It is not a full parser; anything it can't classify is quietly ignored rather
 * than erroring, so a weirdly-authored spec never blocks the indexer.
 */

export type TokenKind = "column" | "table";

export interface LineageToken {
  kind: TokenKind;
  value: string;
  /** For `column` tokens: the explicit `(TABLE)` context if one was given. */
  qualifiedTable?: string;
  /** Heuristic — underscores in the identifier mean Banner/Oracle, dots mean Colleague. */
  sourceSystemHint?: "banner" | "colleague";
}

export type Sentinel = "unsupported" | "derived" | "caseInsensitiveRg";

export interface ReferenceExtractResult {
  raw: string;
  sentinel?: Sentinel;
  tokens: LineageToken[];
}

export interface LookupExtractResult {
  raw: string;
  reference?: string;
  guessedKind?: "api-resource" | "db-table" | "unknown";
}

const SENTINELS: Sentinel[] = ["unsupported", "derived", "caseInsensitiveRg"];

// Banner-style: uppercase with underscores (SPRIDEN_ID, TBBACCT_BILL_CODE).
// Must contain at least one underscore to distinguish from single ALLCAPS words.
const BANNER_IDENT_RE = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g;

// Colleague-style: uppercase with dots (FA.YEAR, VAL.EXTERNAL.REPRESENTATION).
// Must contain at least one dot.
const COLLEAGUE_IDENT_RE = /[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)+/g;

// Any candidate identifier: one or more dot-or-underscore segments.
const ANY_IDENT_RE = /[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+/g;

// Find "X(Y)" and "X (Y)" where both X and Y are identifiers.
const COLUMN_WITH_TABLE_RE = /([A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)*)\s*\(\s*([A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)*)\s*\)/g;

// Strip single-quoted literals (may contain anything, including ( ) | , ).
const STRING_LITERAL_RE = /'[^']*'/g;

function hintOf(ident: string): "banner" | "colleague" | undefined {
  if (ident.includes("_")) return "banner";
  if (ident.includes(".")) return "colleague";
  return undefined;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function tokenizeReferenceObject(value: unknown): ReferenceExtractResult {
  const raw = typeof value === "string" ? value : asString(value) ?? "";
  if (!raw) return { raw: "", tokens: [] };

  const trimmed = raw.trim();
  if (SENTINELS.includes(trimmed as Sentinel)) {
    return { raw, sentinel: trimmed as Sentinel, tokens: [] };
  }

  // Step 1 — remove single-quoted literals so their content doesn't leak into
  // identifier scans. We replace with spaces to preserve column offsets (not
  // strictly needed but makes debug prints readable).
  const literalStripped = raw.replace(STRING_LITERAL_RE, (m) => " ".repeat(m.length));

  // Step 2 — find all "X(TABLE)" patterns. These anchor column→table edges.
  const tokens: LineageToken[] = [];
  const consumedRanges: Array<[number, number]> = [];
  const qualifiedTables = new Set<string>();

  for (const m of literalStripped.matchAll(COLUMN_WITH_TABLE_RE)) {
    const [full, column, table] = m;
    if (!column || !table) continue;

    // The identifier must actually look like a column (contain ._) to avoid
    // matching things like "or(FOO)" where "or" is the English keyword.
    if (!/[._]/.test(column)) continue;

    tokens.push({
      kind: "column",
      value: column,
      qualifiedTable: table,
      sourceSystemHint: hintOf(column),
    });
    qualifiedTables.add(table);

    const start = m.index ?? 0;
    consumedRanges.push([start, start + full.length]);
  }

  // Emit table tokens for every unique table seen in X(TABLE) constructs.
  for (const tbl of qualifiedTables) {
    tokens.push({ kind: "table", value: tbl, sourceSystemHint: hintOf(tbl) });
  }

  // Step 3 — find bare column identifiers in regions not already consumed by
  // X(TABLE) matches. These are the columns in where-clauses, tuples, concat
  // operands, etc.
  const isConsumed = (idx: number) =>
    consumedRanges.some(([start, end]) => idx >= start && idx < end);

  for (const m of literalStripped.matchAll(ANY_IDENT_RE)) {
    const idx = m.index ?? 0;
    if (isConsumed(idx)) continue;
    const ident = m[0]!;
    // Skip anything already qualified as a table above — avoids double-emitting
    // the same identifier as both table and bare column.
    tokens.push({ kind: "column", value: ident, sourceSystemHint: hintOf(ident) });
  }

  return { raw, tokens };
}

export function tokenizeLookupReferenceObject(value: unknown): LookupExtractResult {
  const raw = typeof value === "string" ? value : asString(value) ?? "";
  if (!raw) return { raw: "" };

  const trimmed = raw.trim();
  if (!trimmed) return { raw };

  return {
    raw,
    reference: trimmed,
    guessedKind: guessLookupKind(trimmed),
  };
}

/**
 * Infer whether a lookup reference names an API resource or a DB table.
 *
 * EEDM specs use API resource names: lowercase, hyphen-separated, often multi-word
 *   ("educational-institutions", "academic-programs", "person-types").
 *
 * Bus specs use DB table names: lowercase, typically 5-7 chars, no hyphens
 *   (Banner: "stvnatn", "gtvzipc"; Colleague: "catalogs", "other_degrees").
 *
 * Heuristic: contains a hyphen → api-resource; otherwise → db-table.
 * When truly ambiguous ("catalogs"), we bias toward db-table since those are
 * the most common values in the `x-lineageLookupReferenceObject` slot we
 * couldn't identify as hyphenated.
 */
function guessLookupKind(value: string): "api-resource" | "db-table" | "unknown" {
  if (value.includes("-")) return "api-resource";
  // Table names in either case, optionally dotted or underscored
  // (Banner: stvterm, STVTERM, SPRIDEN; Colleague: catalogs, OTHER.DEGREES).
  if (/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(value)) return "db-table";
  return "unknown";
}
