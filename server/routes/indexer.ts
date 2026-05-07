import { existsSync } from "node:fs";
import type { RouteHandler } from "./types.ts";
import { db, detachDb } from "../db.ts";
import {
  clearIndexFiles,
  indexCatalog,
  ScanInFlightError,
  META_LAST_SCAN_STATUS,
  META_LAST_SCAN_STARTED,
  META_LAST_SCAN_FINISHED,
  META_LAST_SCAN_ERROR,
  type LastScanStatus,
} from "../indexer/index.ts";
import { countRows, getMeta } from "../indexer/sqlite.ts";
import { errorResponse } from "../lib/http.ts";

export const handleIndexer: RouteHandler = async (req, url) => {
  if (url.pathname === "/api/index/scan" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { catalogPath?: string };
    const catalogPath = body.catalogPath ?? url.searchParams.get("path") ?? "";
    if (!catalogPath) {
      return errorResponse("catalogPath required", 400);
    }
    if (!existsSync(catalogPath)) {
      return errorResponse("catalog folder not found", 404, { catalogPath });
    }
    try {
      const stats = await indexCatalog(catalogPath, { db: db(), signal: req.signal });
      return Response.json({ catalogPath, ...stats });
    } catch (err) {
      if (err instanceof ScanInFlightError) {
        return errorResponse("scan-in-flight", 409);
      }
      throw err;
    }
  }

  // Streaming version of the catalog scan. Emits Server-Sent Events so the UI
  // can show a progress bar. EventSource (browser API) is GET-only, so the
  // catalog path comes via query param.
  if (url.pathname === "/api/index/scan-stream") {
    const catalogPath = url.searchParams.get("path") ?? "";
    if (!catalogPath) return errorResponse("path required", 400);
    if (!existsSync(catalogPath)) {
      return errorResponse("catalog folder not found", 404, { catalogPath });
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
            signal: req.signal,
            onProgress: (p) => emit("progress", p),
          });
          emit("done", { catalogPath, ...stats });
        } catch (err) {
          // Client closed the tab/EventSource — surface the cause via meta
          // (already set by indexCatalog) but skip the SSE emit, the stream
          // is already gone.
          if (req.signal.aborted) return;
          if (err instanceof ScanInFlightError) {
            emit("error", { message: "Another scan is already in progress.", code: "scan-in-flight" });
          } else {
            emit("error", { message: (err as Error).message });
          }
        } finally {
          try { controller.close(); } catch { /* already closed by abort */ }
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
    const apiCount = countRows(handle, "apis");
    const endpointCount = countRows(handle, "endpoints");
    const columnCount = countRows(handle, "columns");
    const distinctColumnCount = handle.query<{ c: number }, []>(
      `SELECT count(DISTINCT column_name) as c FROM columns WHERE kind = 'column'`,
    ).get()?.c ?? 0;
    const lineageEdgeCount = countRows(handle, "lineage_edges");
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

    // Scan-status snapshot — null `status` means no scan has ever run on this
    // index (fresh DB / freshly cleared). UI treats that as "clean", not
    // "incomplete".
    const lastScan: {
      status: LastScanStatus | null;
      startedAt: number | null;
      finishedAt: number | null;
      error: string | null;
    } = {
      status: (getMeta(handle, META_LAST_SCAN_STATUS) as LastScanStatus | null) || null,
      startedAt: numOrNull(getMeta(handle, META_LAST_SCAN_STARTED)),
      finishedAt: numOrNull(getMeta(handle, META_LAST_SCAN_FINISHED)),
      error: getMeta(handle, META_LAST_SCAN_ERROR) || null,
    };

    return Response.json({
      apiCount, endpointCount, columnCount, distinctColumnCount,
      lineageEdgeCount, families, domains, errors, lastScan,
    });
  }
};

function numOrNull(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
