export interface ExtractedFilter {
  /** Top-level JSON key: "names", "roles", "credentials", ... */
  rootKey: string;
  /** Name of the leaf field: "firstName", "role", "type". Equal to rootKey for scalar-valued roots. */
  leafPath: string;
  /** Title-cased label for the UI: "First Name", "Role". */
  label: string;
  /** Array index path into the composed JSON: ["names","0","firstName"] or ["personFilter"]. */
  fullPath: string[];
}

/**
 * Scrape a parameter's description (and optional example) for `?paramName={...}`
 * URL blocks. Extracts leaf paths and Title-Cases labels.
 *
 * Tolerant: malformed JSON blocks are skipped; duplicates are deduped by rootKey+leafPath.
 */
export function scrapeCriteriaFilters(
  description: string,
  paramName: string,
  example?: string,
): ExtractedFilter[] {
  const blocks = findBlocks(description, paramName);
  if (example && example.trim()) blocks.push(example);

  const seen = new Set<string>();
  const out: ExtractedFilter[] = [];

  for (const raw of blocks) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (!isObject(parsed)) continue;

    for (const [rootKey, value] of Object.entries(parsed)) {
      for (const leaf of walkRoot(rootKey, value)) {
        const dedupKey = `${leaf.rootKey}.${leaf.leafPath}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push(leaf);
      }
    }
  }

  return out;
}

/**
 * Find every `?<paramName>={...}` JSON block in the text. Braces are balanced
 * across newlines. Non-matching braces cause that block to be dropped (caller
 * also JSON.parses, which acts as a second sanity gate).
 */
function findBlocks(text: string, paramName: string): string[] {
  const results: string[] = [];
  const needle = `?${paramName}=`;
  let i = 0;
  while (true) {
    const start = text.indexOf(needle, i);
    if (start === -1) break;
    const braceStart = start + needle.length;
    if (text[braceStart] !== "{") { i = braceStart; continue; }
    // Walk forward counting braces, skipping string contents.
    let depth = 0;
    let j = braceStart;
    let inString = false;
    let escape = false;
    for (; j < text.length; j++) {
      const ch = text[j]!;
      if (escape) { escape = false; continue; }
      if (inString) {
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = false; continue; }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    if (depth === 0 && j > braceStart) {
      results.push(text.slice(braceStart, j));
      i = j;
    } else {
      // Unbalanced — skip past this needle so we don't re-find it.
      i = braceStart + 1;
    }
  }
  return results;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function walkRoot(rootKey: string, value: unknown): ExtractedFilter[] {
  // Array-of-objects: { names: [{firstName, lastName}] } → leaves are firstName, lastName.
  if (Array.isArray(value) && value.length > 0 && isObject(value[0])) {
    return Object.keys(value[0]!).map((leafName) => ({
      rootKey,
      leafPath: leafName,
      label: toTitleCase(leafName),
      fullPath: [rootKey, "0", leafName],
    }));
  }
  // Scalar-valued root: { personFilter: "uuid" } → single leaf = rootKey.
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{
      rootKey,
      leafPath: rootKey,
      label: toTitleCase(rootKey),
      fullPath: [rootKey],
    }];
  }
  // Plain object: { obj: {a: 1, b: 2} } → leaves are a, b under rootKey (no [0] intermediate).
  if (isObject(value)) {
    return Object.keys(value).map((leafName) => ({
      rootKey,
      leafPath: leafName,
      label: toTitleCase(leafName),
      fullPath: [rootKey, leafName],
    }));
  }
  return [];
}

/**
 * camelCase → "Title Case". Inserts a space before each uppercase letter,
 * capitalises the first letter, leaves existing spaces alone.
 */
function toTitleCase(camel: string): string {
  if (!camel) return camel;
  const spaced = camel.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
