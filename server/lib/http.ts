/**
 * Tiny shared helpers used across `server/routes/*.ts`. Kept dependency-free
 * so route handlers can import without dragging in the indexer or auth
 * modules.
 */

/**
 * Build a `Response.json({ error, ...extra }, { status })` shape. Replaces
 * the ~33 hand-rolled instances scattered across route modules so the error
 * envelope stays consistent.
 */
export function errorResponse(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, ...(extra ?? {}) }, { status });
}

/**
 * Type-guard for "this `unknown` is a plain object" — i.e. typeof is
 * "object" AND not null AND not an array. Used wherever YAML-parsed
 * blobs need shape-validation before further property access.
 */
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
