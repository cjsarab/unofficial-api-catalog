import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";

// Global search across APIs, columns, tables, and families.
// Supports inline filters that narrow the result set:
//   fam:<substring>   — only APIs whose family contains this (case-insensitive)
//   sys:<substring>   — only APIs whose source_system contains this
//   dom:<substring>   — only APIs whose source_domain contains this
//   status:<value>    — only APIs with matching release_status (ga, beta)
//   col:<text>        — limit to the Columns section (others empty)
//   tbl:<text>        — limit to the Tables section
//   api:<text>        — limit to the APIs section
//
// Text outside those filter tokens is the primary search term.
export const handleSearch: RouteHandler = (_req, url) => {
  if (url.pathname !== "/api/search") return;

  const raw = (url.searchParams.get("q") ?? "").trim();
  if (!raw) return Response.json({ q: "", apis: [], columns: [], tables: [], families: [] });

  const filters: Record<string, string> = {};
  const FILTER_KEYS = ["fam", "sys", "dom", "status", "col", "tbl", "api"];
  let q = raw;
  for (const key of FILTER_KEYS) {
    const re = new RegExp(`\\b${key}:([^\\s]+)`, "i");
    const m = q.match(re);
    if (m) {
      filters[key] = m[1]!;
      q = (q.slice(0, m.index) + q.slice((m.index ?? 0) + m[0].length)).trim();
    }
  }

  // The "scoped" filters (col:/tbl:/api:) narrow which sections we populate.
  const scope = filters.col
    ? "columns"
    : filters.tbl
    ? "tables"
    : filters.api
    ? "apis"
    : "all";
  // If a scope filter was given, its value is the primary text for that
  // section (e.g. col:SPRIDEN → search for SPRIDEN inside Columns).
  const scopeText = filters.col ?? filters.tbl ?? filters.api ?? q;

  const handle = db();
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const like = "%" + scopeText.toUpperCase() + "%";
  const prefix = scopeText.toUpperCase() + "%";

  // APIs: match resource name, title, or description. Extra filters further narrow.
  let apis: Array<{
    api_id: number;
    family: string;
    resource: string;
    version: string;
    title: string | null;
    source_system: string | null;
    source_domain: string | null;
    release_status: string | null;
  }> = [];
  if (scope === "all" || scope === "apis") {
    // All anonymous ? binds in textual order — simpler than mixing numbered
    // positional with dynamic extras (the previous version miscounted when
    // a filter like `fam:` was added).
    const extraWhere: string[] = [];
    const extraBinds: Array<string | number> = [];
    if (filters.fam) {
      extraWhere.push(`upper(family) LIKE ?`);
      extraBinds.push("%" + filters.fam.toUpperCase() + "%");
    }
    if (filters.sys) {
      extraWhere.push(`upper(coalesce(source_system, '')) LIKE ?`);
      extraBinds.push("%" + filters.sys.toUpperCase() + "%");
    }
    if (filters.dom) {
      extraWhere.push(`upper(coalesce(source_domain, '')) LIKE ?`);
      extraBinds.push("%" + filters.dom.toUpperCase() + "%");
    }
    if (filters.status) {
      extraWhere.push(`lower(coalesce(release_status, '')) = ?`);
      extraBinds.push(filters.status.toLowerCase());
    }
    const extraClause = extraWhere.length ? ` AND ${extraWhere.join(" AND ")}` : "";

    const binds: Array<string | number> = [
      like, like, like,      // 3 × WHERE LIKE
      ...extraBinds,
      prefix, prefix,        // 2 × ORDER BY CASE
      limit,                 // LIMIT
    ];

    apis = handle
      .query<
        {
          api_id: number;
          family: string;
          resource: string;
          version: string;
          title: string | null;
          source_system: string | null;
          source_domain: string | null;
          release_status: string | null;
        },
        // deliberately loose tuple — bind count varies with filters
        any
      >(
        `
        SELECT id AS api_id, family, resource, version, title,
               source_system, source_domain, release_status
        FROM apis
        WHERE (upper(resource) LIKE ?
               OR upper(coalesce(title, '')) LIKE ?
               OR upper(coalesce(description, '')) LIKE ?)${extraClause}
        ORDER BY
          CASE
            WHEN upper(resource) LIKE ? THEN 0
            WHEN upper(coalesce(title, '')) LIKE ? THEN 1
            ELSE 2
          END,
          resource
        LIMIT ?
        `,
      )
      .all(...binds);
  }

  // Columns: distinct column_name, prefix-match ranked first.
  let columns: Array<{ column_name: string; api_count: number }> = [];
  if (scope === "all" || scope === "columns") {
    columns = handle
      .query<{ column_name: string; api_count: number }, [string, string, number]>(
        `
        SELECT column_name, count(DISTINCT api_id) AS api_count
        FROM columns
        WHERE kind = 'column' AND upper(column_name) LIKE ?
        GROUP BY column_name
        ORDER BY CASE WHEN upper(column_name) LIKE ? THEN 0 ELSE 1 END, api_count DESC, column_name
        LIMIT ?
        `,
      )
      .all(like, prefix, limit);
  }

  // Tables: derived from the same prefix logic as /api/tables.
  let tables: Array<{ table: string; api_count: number }> = [];
  if (scope === "all" || scope === "tables") {
    tables = handle
      .query<{ table: string; api_count: number }, [string, string, number]>(
        `
        WITH tables AS (
          SELECT DISTINCT upper(table_name) AS t, api_id
          FROM columns WHERE table_name IS NOT NULL AND kind = 'column'
          UNION
          SELECT DISTINCT upper(substr(column_name, 1, instr(column_name, '_') - 1)) AS t, api_id
          FROM columns WHERE kind = 'column' AND instr(column_name, '_') > 0
          UNION
          SELECT DISTINCT upper(to_ref), from_api_id FROM lineage_edges WHERE to_kind = 'db-table'
        )
        SELECT t AS "table", count(DISTINCT api_id) AS api_count
        FROM tables
        WHERE t IS NOT NULL AND t != '' AND t LIKE ?
        GROUP BY t
        ORDER BY CASE WHEN t LIKE ? THEN 0 ELSE 1 END, api_count DESC
        LIMIT ?
        `,
      )
      .all(like, prefix, limit);
  }

  // Families (always show, small cap).
  const families = handle
    .query<{ family: string; api_count: number }, [string, number]>(
      `
      SELECT family, count(*) AS api_count
      FROM apis
      WHERE upper(family) LIKE ?
      GROUP BY family
      ORDER BY api_count DESC
      LIMIT ?
      `,
    )
    .all(like, 5);

  return Response.json({ q: raw, filters, apis, columns, tables, families });
};
