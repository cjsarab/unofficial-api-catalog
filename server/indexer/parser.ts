import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";

import { extractLineageFromSpec, type LineageAnnotation } from "./lineage.ts";

/**
 * Ellucian specs sometimes wrap long `$ref` strings at column 99 using YAML's
 * backslash line-continuation (`\<NL>` inside a double-quoted scalar). The
 * `yaml` package balks on these when they appear with deep indentation, so we
 * pre-join continuations before handing the source to the parser. This only
 * affects physical-line `\<NL>whitespace` sequences — escape codes like `\n`,
 * `\t`, `\\` survive intact because they don't contain an actual newline.
 */
function preprocessYaml(source: string): string {
  return source.replace(/\\(\r?\n)[ \t]*/g, "");
}

export interface ParsedEndpoint {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  operationId?: string;
}

export interface ParsedSpec {
  title?: string;
  description?: string;
  specVersion?: string;
  sourceSystem?: string;
  sourceDomain?: string;
  sourceTitle?: string;
  apiType?: string;
  releaseStatus?: string;
  audience?: string;
  endpoints: ParsedEndpoint[];
  lineage: LineageAnnotation[];
  /** Present when the YAML didn't parse or was malformed. */
  parseError?: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"] as const;

type YamlObj = Record<string, unknown>;
const isObj = (v: unknown): v is YamlObj => typeof v === "object" && v !== null;
const asString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : v == null ? undefined : String(v);

export async function parseSpec(filePath: string): Promise<ParsedSpec> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    return { endpoints: [], lineage: [], parseError: `read failed: ${(err as Error).message}` };
  }

  // Two-stage tolerant parsing:
  //   1. Strict parse first — fastest and catches 99% of specs.
  //   2. On failure: preprocess line-continuations, relax uniqueKeys (some
  //      Ellucian specs have genuine duplicate keys — last one wins).
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (firstErr) {
    try {
      doc = parseYaml(preprocessYaml(content), { uniqueKeys: false });
    } catch {
      return {
        endpoints: [],
        lineage: [],
        parseError: `yaml parse failed: ${(firstErr as Error).message}`,
      };
    }
  }

  if (!isObj(doc)) {
    return { endpoints: [], lineage: [], parseError: "top-level is not an object" };
  }

  const info = isObj(doc.info) ? doc.info : {};
  const paths = isObj(doc.paths) ? doc.paths : {};

  const endpoints: ParsedEndpoint[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObj(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isObj(op)) continue;
      endpoints.push({
        path,
        method: method.toUpperCase(),
        summary: asString(op.summary),
        description: asString(op.description),
        operationId: asString(op.operationId),
      });
    }
  }

  return {
    title: asString(info.title),
    description: asString(info.description),
    specVersion: asString(info.version),
    sourceSystem: asString(info["x-source-system"]),
    sourceDomain: asString(info["x-source-domain"]),
    sourceTitle: asString(info["x-source-title"]),
    apiType: asString(info["x-api-type"]),
    releaseStatus: asString(info["x-release-status"]),
    audience: asString(info["x-audience"]),
    endpoints,
    lineage: extractLineageFromSpec(doc),
  };
}
