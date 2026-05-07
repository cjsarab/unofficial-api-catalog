import type { OpenAPISchema } from "../../lib/openapi.ts";

/**
 * Build a "required-fields-only" skeleton value from an OpenAPI schema.
 * Used by the Try panel's Body tab to prefill the raw-JSON textarea when
 * the spec doesn't ship a curated example.
 *
 * Handles the schema shapes Ellucian specs use in the wild:
 * - Primitives (string/integer/number/boolean), with format-aware string
 *   placeholders for uuid/date/date-time and respect for `default` / `enum`.
 * - `type: "object"` with `properties` + `required`.
 * - `type: "array"` with `items`.
 * - **Composition keywords** — `oneOf` / `anyOf` (pick first variant) and
 *   `allOf` (shallow-merge variants: union the `required` lists, combine
 *   the `properties` maps, then build skeleton from the merged shape).
 *   Heavy in EEDM/CRM specs.
 * - Typeless objects (no `type` but `properties` present — legal OpenAPI).
 * - Final fallback: empty object `{}` for anything that smells like a
 *   request body, rather than literal `null` (which is the user-hostile
 *   thing the previous version produced).
 *
 * Note: assumes `$ref` resolution has already happened upstream (the
 * server's extractEndpoint dereferences the request body before sending).
 */
export function buildSkeleton(schema: OpenAPISchema | undefined): unknown {
  if (!schema) return {};
  return walk(schema, 0);
}

const MAX_DEPTH = 8;

function walk(s: OpenAPISchema, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;

  if (s.default !== undefined) return s.default;
  if (s.enum && s.enum.length > 0) return s.enum[0];

  // Composition keywords come *before* the `type` checks because a schema
  // can carry both (`type: object` + `allOf: [...]`) — composition wins
  // since it's how the actual shape is described.
  if (s.allOf && s.allOf.length > 0) {
    return walk(mergeAllOf(s.allOf), depth + 1);
  }
  if (s.oneOf && s.oneOf.length > 0) return walk(s.oneOf[0]!, depth + 1);
  if (s.anyOf && s.anyOf.length > 0) return walk(s.anyOf[0]!, depth + 1);

  if (s.type === "string") {
    if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (s.format === "date") return "2026-01-01";
    if (s.format === "date-time") return "2026-01-01T00:00:00Z";
    return "";
  }
  if (s.type === "integer" || s.type === "number") return s.minimum ?? 0;
  if (s.type === "boolean") return false;
  if (s.type === "array") return s.items ? [walk(s.items, depth + 1)] : [];

  // Object — either declared `type: "object"` or typeless-but-`properties`.
  if (s.type === "object" || s.properties) {
    const required = new Set(s.required ?? []);
    const out: Record<string, unknown> = {};
    if (s.properties) {
      for (const [k, sub] of Object.entries(s.properties)) {
        if (required.has(k)) out[k] = walk(sub, depth + 1);
      }
    }
    return out;
  }

  // Truly unknown — better an empty object than literal `null` for the
  // common case of "this is a body but the schema is opaque".
  return {};
}

/**
 * Shallow-merge a list of `allOf` variants into one schema. Unions the
 * `required` lists; later variants' `properties` win on key collisions
 * (matches OpenAPI's "extend" intent — extension fragments override base).
 */
function mergeAllOf(variants: OpenAPISchema[]): OpenAPISchema {
  const merged: OpenAPISchema = { type: "object", properties: {}, required: [] };
  const requiredSet = new Set<string>();
  for (const v of variants) {
    if (v.type && !merged.type) merged.type = v.type;
    if (v.properties) {
      merged.properties = { ...merged.properties, ...v.properties };
    }
    if (v.required) {
      for (const r of v.required) requiredSet.add(r);
    }
  }
  merged.required = [...requiredSet];
  return merged;
}
