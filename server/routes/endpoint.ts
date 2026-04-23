import { parse as parseYaml } from "yaml";
import { readFileSync, statSync } from "node:fs";

import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";

// OpenAPI subset — narrowed; same shape the client consumes.
export interface ExtractedEndpoint {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: unknown[];
  requestBody: unknown | null;
  responses: Record<string, unknown>;
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
  if (typeof spec !== "object" || spec === null) throw new Error("spec did not parse to an object");

  const paths = (spec as Record<string, unknown>)["paths"];
  if (typeof paths !== "object" || paths === null) return null;

  const lowerMethod = method.toLowerCase();
  if (!HTTP_METHODS.includes(lowerMethod)) return null;

  const pathItem = (paths as Record<string, unknown>)[path];
  if (typeof pathItem !== "object" || pathItem === null) return null;

  const op = (pathItem as Record<string, unknown>)[lowerMethod];
  if (typeof op !== "object" || op === null) return null;

  const operation = op as Record<string, unknown>;
  return {
    method: lowerMethod.toUpperCase(),
    path,
    summary: typeof operation.summary === "string" ? operation.summary : null,
    description: typeof operation.description === "string" ? operation.description : null,
    parameters: Array.isArray(operation.parameters) ? (operation.parameters as unknown[]) : [],
    requestBody: (typeof operation.requestBody === "object" && operation.requestBody !== null)
      ? operation.requestBody
      : null,
    responses: (typeof operation.responses === "object" && operation.responses !== null)
      ? (operation.responses as Record<string, unknown>)
      : {},
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
    return Response.json({ error: "method, path, version query params required" }, { status: 400 });
  }

  const handle = db();
  const row = handle
    .query<{ file_path: string }, [string, string, string]>(
      `SELECT file_path FROM apis WHERE family = ? AND resource = ? AND version = ?`,
    )
    .get(family, resource, version);
  if (!row) {
    return Response.json({ error: "api not found", family, resource, version }, { status: 404 });
  }

  let yaml: string;
  try {
    yaml = readWithCache(row.file_path);
  } catch (err) {
    return Response.json({ error: "spec file unreadable", detail: (err as Error).message }, { status: 500 });
  }

  let extracted: ExtractedEndpoint | null;
  try {
    extracted = extractEndpoint(yaml, method, path);
  } catch (err) {
    return Response.json({ error: "spec parse failed", detail: (err as Error).message }, { status: 500 });
  }
  if (!extracted) {
    return Response.json({ error: "endpoint-not-found", method, path }, { status: 404 });
  }

  return Response.json(extracted);
};
