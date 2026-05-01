import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";
import { errorResponse } from "../lib/http.ts";

// NOTE: route-order matters within this module — the prefix check for
// /api/tables/:name MUST come before the exact /api/tables check, otherwise
// the broader prefix would swallow /api/tables (it doesn't, since the exact
// path lacks the trailing slash, but readers should preserve this ordering).
export const handleTables: RouteHandler = (_req, url) => {
  // Every API that references a given table — three routes:
  //   1. columns.table_name matches (explicit X(TABLE) qualifier)
  //   2. columns.column_name starts with <TABLE>_ (Banner prefix inference)
  //   3. lineage_edges.to_ref matches (x-lineageLookupReferenceObject pointer)
  // All matches are case-insensitive because Ellucian authoring mixes
  // stvterm / STVTERM across the catalog.
  if (url.pathname.startsWith("/api/tables/")) {
    const tableName = decodeURIComponent(url.pathname.slice("/api/tables/".length));
    if (!tableName) return errorResponse("table name required", 400);
    const upper = tableName.toUpperCase();
    const lower = tableName.toLowerCase();
    const prefix = upper + "_%"; // Banner-style membership; SQL LIKE pattern.

    const apis = db()
      .query<
        {
          api_id: number;
          family: string;
          resource: string;
          version: string;
          source_system: string | null;
          source_domain: string | null;
          release_status: string | null;
          match_kinds: string;
          distinct_columns: number;
        },
        [string, string, string, string]
      >(
        `
        WITH matches AS (
          SELECT DISTINCT a.id AS api_id, 'explicit-qualifier' AS kind, c.column_name AS col
          FROM apis a JOIN columns c ON c.api_id = a.id
          WHERE c.kind = 'column' AND upper(c.table_name) = ?

          UNION ALL
          SELECT DISTINCT a.id, 'prefix-inference', c.column_name
          FROM apis a JOIN columns c ON c.api_id = a.id
          WHERE c.kind = 'column' AND c.column_name LIKE ?

          UNION ALL
          SELECT DISTINCT a.id, 'lineage-edge', NULL
          FROM apis a JOIN lineage_edges e ON e.from_api_id = a.id
          WHERE e.to_kind = 'db-table' AND (upper(e.to_ref) = ? OR lower(e.to_ref) = ?)
        )
        SELECT a.id AS api_id, a.family, a.resource, a.version,
               a.source_system, a.source_domain, a.release_status,
               group_concat(DISTINCT m.kind) AS match_kinds,
               count(DISTINCT m.col) AS distinct_columns
        FROM matches m
        JOIN apis a ON a.id = m.api_id
        GROUP BY a.id
        ORDER BY distinct_columns DESC, a.family, a.resource
      `,
      )
      .all(upper, prefix, upper, lower);

    const columns = db()
      .query<
        { column_name: string; api_count: number; total_occurrences: number },
        [string, string]
      >(
        `
        SELECT column_name,
               count(DISTINCT api_id) AS api_count,
               count(*) AS total_occurrences
        FROM columns
        WHERE kind = 'column'
          AND (upper(table_name) = ? OR column_name LIKE ?)
        GROUP BY column_name
        ORDER BY api_count DESC, total_occurrences DESC
      `,
      )
      .all(upper, prefix);

    // At-a-glance breakdowns across the matched APIs (same UNION as above).
    const matchCte = `
      WITH matches AS (
        SELECT DISTINCT a.id AS api_id FROM apis a JOIN columns c ON c.api_id = a.id
        WHERE c.kind = 'column' AND upper(c.table_name) = ?
        UNION
        SELECT DISTINCT a.id FROM apis a JOIN columns c ON c.api_id = a.id
        WHERE c.kind = 'column' AND c.column_name LIKE ?
        UNION
        SELECT DISTINCT a.id FROM apis a JOIN lineage_edges e ON e.from_api_id = a.id
        WHERE e.to_kind = 'db-table' AND (upper(e.to_ref) = ? OR lower(e.to_ref) = ?)
      )
    `;
    const handle = db();
    const byFamily = handle
      .query<{ family: string; c: number }, [string, string, string, string]>(
        matchCte +
          `SELECT a.family, count(*) as c FROM apis a JOIN matches m ON a.id = m.api_id
           GROUP BY a.family ORDER BY c DESC`,
      )
      .all(upper, prefix, upper, lower);
    const bySourceSystem = handle
      .query<{ source_system: string | null; c: number }, [string, string, string, string]>(
        matchCte +
          `SELECT a.source_system, count(*) as c FROM apis a JOIN matches m ON a.id = m.api_id
           GROUP BY a.source_system ORDER BY c DESC`,
      )
      .all(upper, prefix, upper, lower);
    const byDomain = handle
      .query<{ source_domain: string | null; c: number }, [string, string, string, string]>(
        matchCte +
          `SELECT a.source_domain, count(*) as c FROM apis a JOIN matches m ON a.id = m.api_id
           GROUP BY a.source_domain ORDER BY c DESC`,
      )
      .all(upper, prefix, upper, lower);
    const byStatus = handle
      .query<{ release_status: string | null; c: number }, [string, string, string, string]>(
        matchCte +
          `SELECT a.release_status, count(*) as c FROM apis a JOIN matches m ON a.id = m.api_id
           GROUP BY a.release_status ORDER BY c DESC`,
      )
      .all(upper, prefix, upper, lower);

    return Response.json({
      table: tableName,
      normalized: upper,
      apiCount: apis.length,
      columnCount: columns.length,
      apis,
      columns,
      atAGlance: { byFamily, bySourceSystem, byDomain, byStatus },
    });
  }

  // Top tables by occurrence (union of explicit table_name + Banner-style
  // column prefixes + DB-table lineage edges).
  if (url.pathname === "/api/tables") {
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const rows = db()
      .query<{ table: string; api_count: number }, [number]>(
        `
        WITH tables AS (
          SELECT DISTINCT upper(table_name) AS t, api_id
          FROM columns WHERE table_name IS NOT NULL AND kind = 'column'
          UNION
          SELECT DISTINCT upper(substr(column_name, 1, instr(column_name, '_') - 1)) AS t, api_id
          FROM columns
          WHERE kind = 'column' AND instr(column_name, '_') > 0
          UNION
          SELECT DISTINCT upper(to_ref), from_api_id
          FROM lineage_edges WHERE to_kind = 'db-table'
        )
        SELECT t AS "table", count(DISTINCT api_id) AS api_count
        FROM tables
        WHERE t IS NOT NULL AND t != ''
        GROUP BY t
        ORDER BY api_count DESC
        LIMIT ?
      `,
      )
      .all(limit);
    return Response.json({ limit, tables: rows });
  }
};
