// Shared contracts for the Response Panel.
// Kept deliberately verbose — these flow through ~8 components and 2 libraries.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ResponseTimings {
  authMs: number;     // 0 on JWT cache-hit
  requestMs: number;  // fetch() start → response headers arrived (TTFB)
  responseMs: number; // response headers arrived → body download complete
  totalMs: number;    // client-measured end-to-end; reported by TryPanel
}

export interface ResponseBytes {
  requestBytes: number;
  responseBytes: number;
}

export interface ProxyError {
  error: string;
  detail?: string;
  envId?: string;
}

/** Everything the panel needs to render. Owned by App.svelte, produced by TryPanel. */
export interface ResponseView {
  status: number;            // 0 indicates a client-side network error
  statusText: string;
  /** HTTP method we sent (GET / POST / …). */
  requestMethod: string;
  /** The URL the user actually sent — wire form (percent-encoded). The Response
   *  panel decodes query values for display via `web/lib/url-display.ts`. */
  requestUrl: string;
  headers: Record<string, string>;   // response headers, lower-cased keys
  requestHeaders: Record<string, string>;   // headers we sent (for Headers tab's lower section)
  bodyText: string;          // raw body as text; empty string on 204 etc.
  contentType: string | null;
  timings: ResponseTimings;
  bytes: ResponseBytes;
  proxyError?: ProxyError;   // set when status is our own structured error (400/502 from proxy)
}

// ============================================================================
// Decomposed-table contract (produced by web/docs/response/shape.ts)
// ============================================================================

export type ColumnKind =
  | "scalar"        // direct scalar field on the row object
  | "dotted"        // scalar nested one or two levels deep, shown as "a.b.c"
  | "synthetic"     // _idx / _parent_id / _parent_idx (we invented the column)
  | "nested-chip"   // object or scalar-array that we don't flatten; shown as a chip
  | "count-link";   // pointer to a peer table

export interface Column {
  key: string;
  kind: ColumnKind;
  /** Tooltip for synthetic columns, e.g. explaining _parent_idx fallback. */
  synthNote?: string;
}

export type CellValue =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "chip-array"; count: number; jumpPath: string }
  | { kind: "chip-object"; keyCount: number; jumpPath: string }
  | { kind: "count-link"; count: number; targetTablePath: string; parentRowId?: string | number };

export type Row = { [columnKey: string]: CellValue };

export interface DecomposedTable {
  path: string;                 // "$", "$.data", "$[*].emails", "$[0][2][*].x"
  parentPath: string | null;    // null for root
  label: string;                // rail label: last segment or "root"
  depth: number;                // 0-based; drives rail indent
  rows: Row[];
  columns: Column[];            // ordered: synthetic columns first, then alphabetical
  /** Present only for heterogeneous-run peer tables whose path uses the [a..b] convention. */
  rangeNote?: string;
  /** Set when the column union was truncated from > 30. UI shows a "+M more columns" chip. */
  hiddenColumnCount?: number;
}
