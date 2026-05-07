// Small formatting helpers shared across Response Panel tabs.
// Pure — no imports needed.

/**
 * Format a byte count as B / KB / MB. Zero returns "0 B".
 */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Is this content-type JSON? Accepts `application/json` and any RFC 6838
 * `+json` structured-syntax suffix (e.g. Ellucian's
 * `application/vnd.hedtech.integration.v6+json`). Tolerates trailing
 * parameters like `; charset=utf-8` and any case.
 */
export function isJsonContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  const main = ct.split(";")[0]!.trim().toLowerCase();
  return main === "application/json" || main.endsWith("+json");
}

/**
 * Format a ms count for UI:
 *  - negative or NaN → "0 ms"
 *  - 0..<1 → "< 1 ms"   (avoids a zero-width bar / misleading "0 ms" for real-but-tiny measurements)
 *  - 1..999 → "N ms"
 *  - 1000+ → "N.NN s" with two decimal places
 */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms === 0) return "< 1 ms";
  if (ms < 1) return "< 1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
