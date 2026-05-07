import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";
import { errorResponse } from "../lib/http.ts";

// NOTE: route-order matters within this module — exact paths first, then
// narrower prefixes, then the broadest catch-all profile route last. Reordering
// these `if` blocks will silently break /api/columns/prefixes (it'd be
// swallowed by the broad /api/columns/ prefix check).
export const handleColumns: RouteHandler = (_req, url) => {
  // Top / filtered columns. Used by:
  //   - Catalog overview (top N by api_count)
  //   - Column dictionary sidebar (filter input → flat list)
  //
  // Query params:
  //   q       — prefix/fuzzy filter (case-insensitive). When present, orders by
  //             alphabetical column_name; when absent, orders by api_count DESC.
  //   limit   — default 500 with q (enough to cover any narrow prefix), 30 without
  //   offset  — for paging (rarely used)
  if (url.pathname === "/api/columns") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Number(url.searchParams.get("limit") ?? (q ? 500 : 30));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const handle = db();

    if (q) {
      // Case-insensitive substring match. Rank exact-prefix matches first so
      // typing "SPRID" surfaces SPRIDEN_* before ALT_SPRIDEN_*.
      const pattern = "%" + q.toUpperCase() + "%";
      const prefix = q.toUpperCase() + "%";
      const rows = handle
        .query<
          { column_name: string; api_count: number; total_occurrences: number },
          [string, string, number, number]
        >(
          `
          SELECT column_name,
                 count(DISTINCT api_id) AS api_count,
                 count(*) AS total_occurrences
          FROM columns
          WHERE kind = 'column' AND upper(column_name) LIKE ?
          GROUP BY column_name
          ORDER BY
            CASE WHEN upper(column_name) LIKE ? THEN 0 ELSE 1 END,
            column_name
          LIMIT ? OFFSET ?
        `,
        )
        .all(pattern, prefix, limit, offset);
      return Response.json({ q, limit, offset, columns: rows });
    }

    const rows = handle
      .query<
        { column_name: string; api_count: number; total_occurrences: number },
        [number, number]
      >(
        `
        SELECT column_name,
               count(DISTINCT api_id) AS api_count,
               count(*) AS total_occurrences
        FROM columns
        WHERE kind = 'column'
        GROUP BY column_name
        ORDER BY api_count DESC, total_occurrences DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(limit, offset);
    return Response.json({ limit, offset, columns: rows });
  }

  // Column prefixes (table groups): used when the dictionary's filter is empty
  // so we can render a collapsible "by table prefix" view.
  if (url.pathname === "/api/columns/prefixes") {
    const rows = db()
      .query<{ prefix: string; column_count: number; api_count: number }, []>(
        `
        WITH prefixed AS (
          SELECT DISTINCT column_name,
                 api_id,
                 CASE
                   WHEN instr(column_name, '_') > 0
                     AND (instr(column_name, '.') = 0 OR instr(column_name, '_') < instr(column_name, '.'))
                     THEN substr(column_name, 1, instr(column_name, '_') - 1)
                   WHEN instr(column_name, '.') > 0
                     THEN substr(column_name, 1, instr(column_name, '.') - 1)
                   ELSE column_name
                 END AS prefix
          FROM columns
          WHERE kind = 'column'
        )
        SELECT prefix,
               count(DISTINCT column_name) AS column_count,
               count(DISTINCT api_id) AS api_count
        FROM prefixed
        WHERE prefix IS NOT NULL AND prefix != ''
        GROUP BY prefix
        ORDER BY column_count DESC, prefix
        `,
      )
      .all();
    return Response.json({ prefixes: rows });
  }

  // Columns within a specific prefix (for expanding a table group).
  // Precise match on the first separator: SPRIDEN matches SPRIDEN_ID and
  // SPRIDEN.ID but NOT SPRIDENM_*, SPRIDENS_*. ESCAPE clause stops SQLite's
  // LIKE treating `_` as a wildcard.
  if (url.pathname.startsWith("/api/columns/prefix/")) {
    const prefix = decodeURIComponent(url.pathname.slice("/api/columns/prefix/".length));
    if (!prefix) return errorResponse("prefix required", 400);
    const rows = db()
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
          AND (column_name LIKE ? ESCAPE '\\' OR column_name LIKE ?)
        GROUP BY column_name
        ORDER BY api_count DESC, column_name
        LIMIT 2000
        `,
      )
      .all(prefix + "\\_%", prefix + ".%");
    return Response.json({ prefix, columns: rows });
  }

  // Every API that references a given column, plus at-a-glance breakdowns,
  // other columns on the same table (prefix-inferred), and co-occurring columns
  // (columns appearing in the same APIs as this one).
  if (url.pathname.startsWith("/api/columns/")) {
    const columnName = decodeURIComponent(url.pathname.slice("/api/columns/".length));
    if (!columnName) return errorResponse("column name required", 400);
    const handle = db();

    const apis = handle
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
          api_type: string | null;
          table_name: string | null;
          field_path: string;
          raw_expression: string;
        },
        [string]
      >(
        `
        SELECT a.id as api_id, a.family, a.resource, a.version, a.title,
               a.source_system, a.source_domain, a.release_status, a.api_type,
               c.table_name, c.field_path, c.raw_expression
        FROM columns c
        JOIN apis a ON a.id = c.api_id
        WHERE c.column_name = ? AND c.kind = 'column'
        ORDER BY a.family, a.resource, a.version, c.field_path
        `,
      )
      .all(columnName);

    // At-a-glance: unique-API groupings.
    const byFamily = handle
      .query<{ family: string; c: number }, [string]>(
        `SELECT a.family, count(DISTINCT a.id) as c
         FROM columns c JOIN apis a ON a.id = c.api_id
         WHERE c.column_name = ? AND c.kind = 'column'
         GROUP BY a.family ORDER BY c DESC`,
      )
      .all(columnName);
    const bySourceSystem = handle
      .query<{ source_system: string | null; c: number }, [string]>(
        `SELECT a.source_system, count(DISTINCT a.id) as c
         FROM columns c JOIN apis a ON a.id = c.api_id
         WHERE c.column_name = ? AND c.kind = 'column'
         GROUP BY a.source_system ORDER BY c DESC`,
      )
      .all(columnName);
    const byDomain = handle
      .query<{ source_domain: string | null; c: number }, [string]>(
        `SELECT a.source_domain, count(DISTINCT a.id) as c
         FROM columns c JOIN apis a ON a.id = c.api_id
         WHERE c.column_name = ? AND c.kind = 'column'
         GROUP BY a.source_domain ORDER BY c DESC`,
      )
      .all(columnName);
    const byStatus = handle
      .query<{ release_status: string | null; c: number }, [string]>(
        `SELECT a.release_status, count(DISTINCT a.id) as c
         FROM columns c JOIN apis a ON a.id = c.api_id
         WHERE c.column_name = ? AND c.kind = 'column'
         GROUP BY a.release_status ORDER BY c DESC`,
      )
      .all(columnName);

    // Infer the table prefix from the column name (first segment before _ or .).
    const m = columnName.match(/^([A-Z][A-Z0-9]*)[._]/);
    const inferredTable = m?.[1];

    // Other columns on the same table (Banner-style _prefix or Colleague-style .prefix).
    let otherColumnsOnTable: { column_name: string; api_count: number }[] = [];
    if (inferredTable) {
      otherColumnsOnTable = handle
        .query<
          { column_name: string; api_count: number },
          [string, string, string]
        >(
          `SELECT column_name, count(DISTINCT api_id) AS api_count
           FROM columns
           WHERE kind = 'column'
             AND (column_name LIKE ? ESCAPE '\\' OR column_name LIKE ?)
             AND column_name != ?
           GROUP BY column_name
           ORDER BY api_count DESC, column_name
           LIMIT 20`,
        )
        .all(inferredTable + "\\_%", inferredTable + ".%", columnName);
    }

    // Co-occurs with: columns appearing in the same APIs. Limit cardinality so
    // ubiquitous columns (LDM.GUID.ID) don't dominate every profile.
    const cooccursWith = handle
      .query<
        { column_name: string; shared_apis: number },
        [string, string]
      >(
        `
        WITH home AS (
          SELECT DISTINCT api_id FROM columns
          WHERE column_name = ? AND kind = 'column'
        )
        SELECT column_name, count(DISTINCT api_id) AS shared_apis
        FROM columns
        WHERE kind = 'column'
          AND api_id IN (SELECT api_id FROM home)
          AND column_name != ?
        GROUP BY column_name
        ORDER BY shared_apis DESC, column_name
        LIMIT 20
        `,
      )
      .all(columnName, columnName);

    return Response.json({
      column: columnName,
      occurrences: apis.length,
      distinctApis: new Set(apis.map((r) => r.api_id)).size,
      inferredTable,
      apis,
      atAGlance: {
        byFamily,
        bySourceSystem,
        byDomain,
        byStatus,
      },
      otherColumnsOnTable,
      cooccursWith,
    });
  }
};
