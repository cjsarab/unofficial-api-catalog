/**
 * Lineage-expression helpers shared across docs / column / table profile
 * views. These were previously duplicated in
 * `web/docs/ApiDocsView.svelte` and `web/docs/ColumnProfile.svelte`
 * (one used `splitExpression`, the other `splitExpr` — same logic).
 *
 * `prettyFieldPath` rewrites raw OpenAPI YAML paths into something
 * readable for the UI; `splitExpression` parses an Ellucian lineage
 * expression like `SPRIDEN_ID(SPRIDEN) where SPBPERS_PIDM = SPRIDEN_PIDM`
 * into an interleaved array of text + clickable column/table tokens.
 */

/**
 * Match Banner (`SPRIDEN_ID`) and Colleague (`FA.YEAR`) identifier tokens —
 * an uppercase-leading run optionally followed by `.` or `_` separated
 * uppercase/digit segments. Recognises the same shape that the server-side
 * indexer/tokenizer extracts from `x-lineageReferenceObject`.
 */
export const TOKEN_RE = /[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+/g;

export type ExpressionPart = { kind: "text" | "column" | "table"; text: string };

/**
 * Split a raw lineage expression into clickable tokens + interstitial text.
 * Tokens that match a known table name (provided by caller) are tagged
 * `table`; everything else is tagged `column`.
 */
export function splitExpression(raw: string, tableNames: Set<string>): ExpressionPart[] {
  const parts: ExpressionPart[] = [];
  let lastIndex = 0;
  for (const m of raw.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) parts.push({ kind: "text", text: raw.slice(lastIndex, idx) });
    const token = m[0];
    parts.push({ kind: tableNames.has(token) ? "table" : "column", text: token });
    lastIndex = idx + token.length;
  }
  if (lastIndex < raw.length) parts.push({ kind: "text", text: raw.slice(lastIndex) });
  return parts;
}

/**
 * Prettify raw YAML field paths. Examples:
 *   components.schemas.schema-persons.json.properties.addresses.items.properties.id
 *     → addresses[].id
 *   paths./api/persons.get.parameters.[12]
 *     → GET /api/persons · param[12]
 */
export function prettyFieldPath(raw: string): string {
  let p = raw;

  // paths.<path>.<method>... → rewrite the prefix
  const pathsMatch = p.match(/^paths\.([^.]+)\.(get|post|put|patch|delete|options|head|trace)(\..+)?$/i);
  if (pathsMatch) {
    const [, path, method, rest] = pathsMatch;
    const cleaned = (rest ?? "")
      .replace(/^\.responses\.\d+\.content\.[^.]+\.schema\./, "response.")
      .replace(/^\.requestBody\.content\.[^.]+\.schema\./, "body.")
      .replace(/^\.parameters\.\[(\d+)\]$/, " · param[$1]")
      .replace(/\.properties\./g, ".")
      .replace(/\.items\./g, "[].")
      .replace(/\.oneOf\.\[(\d+)\]\./g, ".variant$1.");
    return `${method!.toUpperCase()} ${path}${cleaned}`;
  }

  // components.schemas.<name>.[properties.]...
  p = p.replace(/^components\.schemas\.[^.]+\.?/, "");
  p = p.replace(/^properties\./, "");
  p = p.replace(/\.properties\./g, ".");
  p = p.replace(/\.items\./g, "[].");
  p = p.replace(/\.oneOf\.\[(\d+)\]\./g, ".variant$1.");
  return p || "(root)";
}
