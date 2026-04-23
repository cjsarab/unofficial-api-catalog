import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";

// Top lineage-edge targets.
export const handleLineage: RouteHandler = (_req, url) => {
  if (url.pathname !== "/api/lineage/targets") return;

  const rows = db()
    .query<{ to_kind: string; to_ref: string; c: number }, []>(
      `SELECT to_kind, to_ref, count(DISTINCT from_api_id) as c
       FROM lineage_edges
       GROUP BY to_kind, to_ref
       ORDER BY c DESC
       LIMIT 30`,
    )
    .all();
  return Response.json({ targets: rows });
};
