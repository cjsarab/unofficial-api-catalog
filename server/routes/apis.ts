import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";

// Full detail for one API resource at a specific version (default: newest ga).
//   GET /api/apis/:family/:resource           → picks the default version
//   GET /api/apis/:family/:resource?version=X → picks X specifically
// The response includes the list of *all* versions for the version dropdown.
export const handleApis: RouteHandler = (_req, url) => {
  if (!url.pathname.startsWith("/api/apis/")) return;

  const rest = url.pathname.slice("/api/apis/".length);
  const parts = rest.split("/").map((s) => decodeURIComponent(s));
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return Response.json({ error: "family and resource required" }, { status: 400 });
  }
  const [family, resource] = parts;
  const versionParam = url.searchParams.get("version") ?? parts[2];

  const handle = db();

  // Gather all versions for this (family, resource).
  const versionRows = handle
    .query<
      {
        id: number;
        version: string;
        title: string | null;
        description: string | null;
        source_system: string | null;
        source_domain: string | null;
        source_title: string | null;
        api_type: string | null;
        release_status: string | null;
        file_path: string;
      },
      [string, string]
    >(
      `SELECT id, version, title, description, source_system, source_domain,
              source_title, api_type, release_status, file_path
       FROM apis
       WHERE family = ? AND resource = ?
       ORDER BY version`,
    )
    .all(family!, resource!);

  if (versionRows.length === 0) {
    return Response.json({ error: "resource not found", family, resource }, { status: 404 });
  }

  // Pick the active version: explicit param if valid, else newest ga,
  // else newest overall.
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map((p) => Number(p) || 0);
    const pb = b.split(".").map((p) => Number(p) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const va = pa[i] ?? 0;
      const vb = pb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  };
  const sortedNewestFirst = [...versionRows].sort((a, b) => cmp(b.version, a.version));
  const active =
    (versionParam && versionRows.find((v) => v.version === versionParam)) ||
    sortedNewestFirst.find((v) => v.release_status === "ga") ||
    sortedNewestFirst[0]!;

  const endpoints = handle
    .query<
      {
        id: number;
        path: string;
        method: string;
        summary: string | null;
        description: string | null;
        operation_id: string | null;
      },
      [number]
    >(
      `SELECT id, path, method, summary, description, operation_id
       FROM endpoints WHERE api_id = ?
       ORDER BY path, method`,
    )
    .all(active.id);

  // Lineage fields: every column/sentinel row for this API, grouped by field_path.
  const fieldRows = handle
    .query<
      {
        column_name: string;
        table_name: string | null;
        source_system: string | null;
        field_path: string;
        raw_expression: string;
        kind: string;
      },
      [number]
    >(
      `SELECT column_name, table_name, source_system, field_path, raw_expression, kind
       FROM columns WHERE api_id = ?
       ORDER BY field_path, column_name`,
    )
    .all(active.id);

  // Group by field_path for display.
  const fieldsByPath = new Map<
    string,
    {
      fieldPath: string;
      rawExpression: string;
      kind: string;
      tokens: {
        columnName: string;
        tableName: string | null;
        sourceSystem: string | null;
      }[];
    }
  >();
  for (const f of fieldRows) {
    const key = f.field_path + "|" + f.raw_expression;
    let entry = fieldsByPath.get(key);
    if (!entry) {
      entry = {
        fieldPath: f.field_path,
        rawExpression: f.raw_expression,
        kind: f.kind,
        tokens: [],
      };
      fieldsByPath.set(key, entry);
    }
    // Skip sentinel rows from the tokens (they have kind other than 'column')
    if (f.kind === "column") {
      entry.tokens.push({
        columnName: f.column_name,
        tableName: f.table_name,
        sourceSystem: f.source_system,
      });
    }
  }

  const apiEdges = handle
    .query<{ to_kind: string; to_ref: string; field_path: string | null }, [number]>(
      `SELECT to_kind, to_ref, field_path
       FROM lineage_edges WHERE from_api_id = ?
       ORDER BY to_kind, to_ref`,
    )
    .all(active.id);

  return Response.json({
    family,
    resource,
    active: {
      id: active.id,
      version: active.version,
      title: active.title,
      description: active.description,
      sourceSystem: active.source_system,
      sourceDomain: active.source_domain,
      sourceTitle: active.source_title,
      apiType: active.api_type,
      releaseStatus: active.release_status,
      filePath: active.file_path,
    },
    versions: sortedNewestFirst.map((v) => ({
      version: v.version,
      releaseStatus: v.release_status,
      isActive: v.id === active.id,
    })),
    endpoints,
    fields: [...fieldsByPath.values()],
    apiEdges,
  });
};
