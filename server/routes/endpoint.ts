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

/**
 * Pure: walk a parsed OpenAPI spec (as YAML source) to find one operation and
 * return just the bits the Try panel cares about.
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

  return {
    method: lowerMethod.toUpperCase(),
    path,
    summary: typeof op.summary === "string" ? op.summary : null,
    description: typeof op.description === "string" ? op.description : null,
    parameters: Array.isArray(op.parameters) ? (op.parameters as OpenAPIParameter[]) : [],
    requestBody: isObject(op.requestBody) ? (op.requestBody as unknown as OpenAPIRequestBody) : null,
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
