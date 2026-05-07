import {
  tokenizeReferenceObject,
  tokenizeLookupReferenceObject,
  type LineageToken,
} from "./tokenizer.ts";

export interface LineageAnnotation {
  /** Dotted path back to the property that carries the annotation (raw YAML path). */
  fieldPath: string;
  /** Raw value of `x-lineageReferenceObject` if present. */
  refRaw?: string;
  /** Raw value of `x-lineageLookupReferenceObject` if present. */
  lookupRaw?: string;
  /** Tokens extracted from `refRaw` (columns + tables). */
  tokens: LineageToken[];
  /** Sentinel classification of `refRaw` (unsupported / derived / caseInsensitiveRg) if applicable. */
  sentinel?: string;
  /** Resolved single reference from `lookupRaw` (an API resource name or a DB table name). */
  lookupReference?: string;
  /** Our guess for how to interpret `lookupReference`. Can be corrected at index time using spec context. */
  lookupGuessedKind?: "api-resource" | "db-table" | "unknown";
}

const LOOKUP_KEY = "x-lineageLookupReferenceObject";
const REF_KEY = "x-lineageReferenceObject";

/**
 * Walk a parsed OpenAPI document and return every lineage annotation found on any
 * property (at any depth). Skips `$ref` pointers and other `x-*` extension values to
 * avoid re-walking string leaves. We preserve the raw YAML path in `fieldPath` —
 * prettification for display is a UI concern.
 */
export function extractLineageFromSpec(doc: unknown): LineageAnnotation[] {
  const out: LineageAnnotation[] = [];
  walk(doc, [], out);
  return out;
}

function walk(node: unknown, path: string[], out: LineageAnnotation[]): void {
  if (node == null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walk(node[i], [...path, `[${i}]`], out);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  const lookupRaw = typeof obj[LOOKUP_KEY] === "string" ? (obj[LOOKUP_KEY] as string) : undefined;
  const refRaw = typeof obj[REF_KEY] === "string" ? (obj[REF_KEY] as string) : undefined;

  if (lookupRaw !== undefined || refRaw !== undefined) {
    const fieldPath = path.join(".");
    const annotation: LineageAnnotation = {
      fieldPath,
      refRaw,
      lookupRaw,
      tokens: [],
    };
    if (refRaw !== undefined) {
      const r = tokenizeReferenceObject(refRaw);
      annotation.tokens = r.tokens;
      if (r.sentinel) annotation.sentinel = r.sentinel;
    }
    if (lookupRaw !== undefined) {
      const l = tokenizeLookupReferenceObject(lookupRaw);
      annotation.lookupReference = l.reference;
      annotation.lookupGuessedKind = l.guessedKind;
    }
    out.push(annotation);
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === "$ref") continue;
    if (k.startsWith("x-")) continue;
    walk(v, [...path, k], out);
  }
}
