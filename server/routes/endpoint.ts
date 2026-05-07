import { parse as parseYaml } from "yaml";
import { readFileSync, statSync } from "node:fs";

import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";
import { errorResponse, isObject } from "../lib/http.ts";
import type { OpenAPIParameter, OpenAPIRequestBody, OpenAPIResponse } from "../../web/lib/openapi.ts";

// OpenAPI subset — narrowed; same shape the client consumes via EndpointSchema.
export interface ExtractedEndpoint {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: OpenAPIParameter[];
  requestBody: OpenAPIRequestBody | null;
  responses: Record<string, OpenAPIResponse>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

const MAX_REF_DEPTH = 6;

/** Resolve a JSON Pointer (`#/components/schemas/Foo`) against the parsed spec. */
function resolveJsonPointer(spec: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = spec;
  for (const part of parts) {
    if (!isObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Recursively replace `{$ref: "#/..."}` nodes in `node` with the resolved value
 * from `spec`. Cycle-safe via a per-path visited set; capped at MAX_REF_DEPTH.
 * External refs (not starting with `#/`) and unresolvable refs are left as-is.
 */
function dereferenceSchema(
  node: unknown,
  spec: unknown,
  visited: Set<string>,
  depth: number,
): unknown {
  if (depth > MAX_REF_DEPTH) return node;
  if (Array.isArray(node)) {
    return node.map((item) => dereferenceSchema(item, spec, visited, depth + 1));
  }
  if (!isObject(node)) return node;

  if (typeof node["$ref"] === "string") {
    const ref = node["$ref"];
    if (!ref.startsWith("#/")) return node;       // external ref — leave as-is
    if (visited.has(ref)) return node;            // cycle — leave the ref node
    const resolved = resolveJsonPointer(spec, ref);
    if (resolved === undefined) return node;       // unresolvable — leave as-is
    const next = new Set(visited);
    next.add(ref);
    return dereferenceSchema(resolved, spec, next, depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = dereferenceSchema(v, spec, visited, depth + 1);
  }
  return out;
}

/**
 * Pure: walk a parsed OpenAPI spec (as YAML source) to find one operation and
 * return just the bits the Try panel cares about. Internal `$ref` nodes inside
 * the request body are resolved against the spec before returning, so the
 * client sees inlined schemas (Ellucian Bus specs define their request bodies
 * as `$ref` to `#/components/schemas/...` — without resolution, the Try
 * panel's "Insert Skeleton" button has nothing to walk and produces `null`).
 */
export function extractEndpoint(
  specYaml: string,
  method: string,
  path: string,
): ExtractedEndpoint | null {
  // Ellucian wrap-quirk preprocessing (lives in server/indexer/parser.ts too).
  const preprocessed = specYaml.replace(/\\(\r?\n)[ \t]*/g, "");
  const spec = parseYaml(preprocessed) as unknown;
  if (!isObject(spec)) throw new Error("spec did not parse to an object");

  const paths = spec["paths"];
  if (!isObject(paths)) return null;

  const lowerMethod = method.toLowerCase();
  if (!HTTP_METHODS.includes(lowerMethod)) return null;

  const pathItem = paths[path];
  if (!isObject(pathItem)) return null;

  const op = pathItem[lowerMethod];
  if (!isObject(op)) return null;

  const rawRequestBody = isObject(op.requestBody) ? (op.requestBody as unknown) : null;
  const requestBody = rawRequestBody
    ? (dereferenceSchema(rawRequestBody, spec, new Set(), 0) as OpenAPIRequestBody)
    : null;

  return {
    method: lowerMethod.toUpperCase(),
    path,
    summary: typeof op.summary === "string" ? op.summary : null,
    description: typeof op.description === "string" ? op.description : null,
    parameters: Array.isArray(op.parameters) ? (op.parameters as OpenAPIParameter[]) : [],
    requestBody,
    responses: isObject(op.responses) ? (op.responses as unknown as Record<string, OpenAPIResponse>) : {},
  };
}

// --- HTTP route --------------------------------------------------------------

interface CacheEntry { mtimeMs: number; yaml: string; }
const fileCache = new Map<string, CacheEntry>();

function readWithCache(filePath: string): string {
  const stat = statSync(filePath);
  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.yaml;
  const yaml = readFileSync(filePath, "utf8");
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, yaml });
  return yaml;
}

export const handleEndpoint: RouteHandler = (_req, url) => {
  // /api/apis/:family/:resource/endpoint?method=M&path=P&version=V
  const m = url.pathname.match(/^\/api\/apis\/([^\/]+)\/([^\/]+)\/endpoint$/);
  if (!m) return;

  const family = decodeURIComponent(m[1]!);
  const resource = decodeURIComponent(m[2]!);
  const method = url.searchParams.get("method");
  const path = url.searchParams.get("path");
  const version = url.searchParams.get("version");

  if (!method || !path || !version) {
    return errorResponse("method, path, version query params required", 400);
  }

  const handle = db();
  const row = handle
    .query<{ file_path: string }, [string, string, string]>(
      `SELECT file_path FROM apis WHERE family = ? AND resource = ? AND version = ?`,
    )
    .get(family, resource, version);
  if (!row) {
    return errorResponse("api not found", 404, { family, resource, version });
  }

  let yaml: string;
  try {
    yaml = readWithCache(row.file_path);
  } catch (err) {
    return errorResponse("spec file unreadable", 500, { detail: (err as Error).message });
  }

  let extracted: ExtractedEndpoint | null;
  try {
    extracted = extractEndpoint(yaml, method, path);
  } catch (err) {
    return errorResponse("spec parse failed", 500, { detail: (err as Error).message });
  }
  if (!extracted) {
    return errorResponse("endpoint-not-found", 404, { method, path });
  }

  return Response.json(extracted);
};
