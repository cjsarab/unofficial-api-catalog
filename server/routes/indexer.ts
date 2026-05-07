import { existsSync } from "node:fs";
import type { RouteHandler } from "./types.ts";
import { db, detachDb } from "../db.ts";
import { clearIndexFiles, indexCatalog } from "../indexer/index.ts";

export const handleIndexer: RouteHandler = async (req, url) => {
  if (url.pathname === "/api/index/scan" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { catalogPath?: string };
    const catalogPath = body.catalogPath ?? url.searchParams.get("path") ?? "";
    if (!catalogPath) {
      return Response.json({ error: "catalogPath required" }, { status: 400 });
    }
    if (!existsSync(catalogPath)) {
      return Response.json({ error: "catalog folder not found", catalogPath }, { status: 404 });
    }
    const stats = await indexCatalog(catalogPath, { db: db() });
    return Response.json({ catalogPath, ...stats });
  }

  // Streaming version of the catalog scan. Emits Server-Sent Events so the UI
  // can show a progress bar. EventSource (browser API) is GET-only, so the
  // catalog path comes via query param.
  if (url.pathname === "/api/index/scan-stream") {
    const catalogPath = url.searchParams.get("path") ?? "";
    if (!catalogPath) return Response.json({ error: "path required" }, { status: 400 });
    if (!existsSync(catalogPath)) {
      return Response.json({ error: "catalog folder not found", catalogPath }, { status: 404 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: string, data: unknown) => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        };
        emit("start", { catalogPath });
        try {
          const stats = await indexCatalog(catalogPath, {
            db: db(),
            onProgress: (p) => emit("progress", p),
          });
          emit("done", { catalogPath, ...stats });
        } catch (err) {
          emit("error", { message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  if (url.pathname === "/api/index/clear" && req.method === "POST") {
    // Detach the cached handle *before* we close and delete it, so any
    // concurrent request that calls db() while this runs opens a fresh
    // connection instead of grabbing a soon-to-be-closed one.
    const handle = detachDb();
    const result = await clearIndexFiles(handle);
    return Response.json({ removed: result });
  }

  if (url.pathname === "/api/index/errors") {
    const rows = db()
      .query<{ path: string; error: string }, []>(
        `SELECT path, error FROM files WHERE parse_status = 'error' ORDER BY path`,
      )
      .all();
    return Response.json({ count: rows.length, errors: rows });
  }

  if (url.pathname === "/api/index/summary") {
    const handle = db();
    const apiCount = handle.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c ?? 0;
    const endpointCount = handle.query<{ c: number }, []>(`SELECT count(*) as c FROM endpoints`).get()?.c ?? 0;
    const columnCount = handle.query<{ c: number }, []>(`SELECT count(*) as c FROM columns`).get()?.c ?? 0;
    const distinctColumnCount = handle.query<{ c: number }, []>(
      `SELECT count(DISTINCT column_name) as c FROM columns WHERE kind = 'column'`,
    ).get()?.c ?? 0;
    const lineageEdgeCount = handle.query<{ c: number }, []>(
      `SELECT count(*) as c FROM lineage_edges`,
    ).get()?.c ?? 0;
    const families = handle
      .query<{ family: string; c: number }, []>(
        `SELECT family, count(*) as c FROM apis GROUP BY family ORDER BY c DESC`,
      )
      .all();
    const domains = handle
      .query<{ source_domain: string; c: number }, []>(
        `SELECT source_domain, count(*) as c FROM apis WHERE source_domain IS NOT NULL GROUP BY source_domain ORDER BY c DESC`,
      )
      .all();
    const errors = handle
      .query<{ c: number }, []>(`SELECT count(*) as c FROM files WHERE parse_status = 'error'`)
      .get()?.c ?? 0;
    return Response.json({
      apiCount, endpointCount, columnCount, distinctColumnCount,
      lineageEdgeCount, families, domains, errors,
    });
  }
};
