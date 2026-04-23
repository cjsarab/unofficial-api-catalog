import { handleApis } from "./apis.ts";
import { handleCatalog } from "./catalog.ts";
import { handleColumns } from "./columns.ts";
import { handleConfig } from "./config.ts";
import { handleEnvironments } from "./environments.ts";
import { handleFamilies } from "./families.ts";
import { handleIndexer } from "./indexer.ts";
import { handleLineage } from "./lineage.ts";
import { handleSearch } from "./search.ts";
import { handleStatic } from "./static.ts";
import { handleStatus } from "./status.ts";
import { handleTables } from "./tables.ts";
import type { RouteHandler } from "./types.ts";

// Each module owns a non-overlapping URL prefix; the dispatcher returns the
// first non-undefined response. Order is mostly cosmetic, but cheap exact-path
// handlers (status, config) come first so the common case bails out early.
const apiHandlers: RouteHandler[] = [
  handleStatus,
  handleConfig,
  handleEnvironments,
  handleCatalog,
  handleIndexer,
  handleSearch,
  handleColumns,
  handleApis,
  handleFamilies,
  handleTables,
  handleLineage,
];

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);

  for (const handler of apiHandlers) {
    const res = await handler(req, url);
    if (res) return res;
  }

  // Any unmatched /api/* path → 501 (distinguishes a route stub from a 404
  // for non-API paths, which the SPA owns).
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "not-yet-implemented", route: url.pathname }, { status: 501 });
  }

  // Static asset / SPA fallback. handleStatic always returns a Response.
  const fallback = await handleStatic(req, url);
  return fallback ?? new Response("not found", { status: 404 });
}
