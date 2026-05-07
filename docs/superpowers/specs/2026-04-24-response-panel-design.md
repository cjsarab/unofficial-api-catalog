# Response Panel — Design Spec

**Date:** 2026-04-24
**Phase:** 2, item 6
**Replaces:** `web/docs/try/ResponseStub.svelte` (inline happy-path stub)
**Status:** design approved, ready for implementation plan

## Context

The Response Panel is the full-width strip that lives in the Shell's bottom `response` slot, underneath the three top panes. Today the slot renders a `PanePlaceholder`; after a send, the Try panel renders an inline `ResponseStub` in the right-hand slot instead. That stub covers the happy JSON path with a status row, a pretty-printed body, and a collapsible headers block — but it sits in the wrong slot and doesn't deliver the Response Panel described in `PLAN.md`.

This spec defines the real Response Panel: four tabs (Raw · Table · Headers · Timing), a decomposition-based table view designed for the PL/SQL-veteran audience, and the small proxy-side change needed to populate a phase-breakdown Timing tab.

## Scope

### In scope

- Four-tab Response Panel rendering the **current** response.
- Auto-decomposition of structured JSON into one or more flat peer tables (the SQL-IDE multi-result-set model).
- Pretty-printed / highlighted Raw tab with a head-slice for very large bodies.
- Headers tab with response + request sections, sensitive-value redaction.
- Timing tab with Auth / Request / Response / Total phase breakdown and bytes.
- Empty / in-flight / error states for every tab.
- Lifting response state from `TryPanel` to `App.svelte`.
- Cancel-previous concurrency (AbortController) when a second Send lands before the first resolves.
- Exhaustive unit tests for the decomposition algorithm.

### Out of scope (explicit)

- Response history ("last N sends per endpoint") — Phase 2 item 8 (request-history sidebar owns that).
- Before/after diff of two responses — Phase 3.
- Pop-out window — Phase 3 polish.
- Copy-as-curl, Save-to-file, CSV / JSON export — Phase 3 polish; `count-link` / nested-chip jump-to-Raw is the only interactive affordance in v1.
- DNS / TCP / TLS phase timings — not cheaply available from Bun `fetch`; punt.

## Architecture

### Data flow

```
App.svelte (single owner of response state)
  ├─ currentResponse: $state<ResponseView | null> = null
  ├─ sendCtl:          AbortController | null         (for cancel-previous)
  │
  ├─ snippet right()    → TryPanel { onSend, onAbort }
  │                         — TryPanel no longer renders ResponseStub inline
  │
  └─ snippet response() → {#if currentResponse}
                            <ResponsePanel {...currentResponse} onclear={...} />
                          {:else}
                            <ResponseEmpty />
                          {/if}
```

`App.svelte` stays the single owner of cross-pane state (it already holds env, config, route, summary). Introducing a store module was considered and rejected: this is the only cross-pane share today, and ~5 lines of state do not justify a new codebase-wide pattern. Revisit if a second share appears.

### Concurrency — cancel-previous

When the user presses F5 / Ctrl+Enter with a send already in flight:

- TryPanel aborts the existing `sendCtl.abort()`.
- A new `AbortController` is created and its signal passed to `fetch`.
- The aborted promise rejects with `DOMException("aborted")` and is silently discarded (no error banner, no state change).
- The in-flight UI state persists until the new send settles — previous tab content stays visible to prevent flicker.

### Component tree

```
web/docs/response/                     ← new folder
├─ ResponsePanel.svelte                  shell: status row + tab strip + tab content
├─ tabs/
│   ├─ TableTab.svelte                   decomposes + renders; owns tree-rail + data-table
│   ├─ RawTab.svelte                     pretty-print + copy + highlight + head-slice
│   ├─ HeadersTab.svelte                 response + request sections + redact-chip
│   └─ TimingTab.svelte                  phases bar + bytes summary
├─ TableRail.svelte                      tree of peer-table paths (chevrons, resize, filter)
├─ DataTable.svelte                      one virtualised table (sort hook, nested-chip rendering)
├─ ResponseEmpty.svelte                  "No request sent yet" placeholder
├─ shape.ts                              pure decomposition algorithm (unit-testable)
├─ shape.test.ts                         exhaustive shape-coverage tests
├─ highlight.ts                          tiny JSON tokenizer → spans (no library)
└─ types.ts                              shared contracts (ResponseView, DecomposedTable, …)
```

Only `ResponsePanel` is imported by `App.svelte`. Everything else is internal to the `response/` folder.

## Tab behaviours

### Table tab — the centrepiece

The PL/SQL-veteran "SQL-grid" view. Algorithm-driven: parse the JSON body, decompose into an ordered list of flat tables, render.

**Layout:**

- If exactly one table is emitted → render DataTable at full width (no rail).
- If 2+ → render TableRail on the left (min-width 280 px, resizable via horizontal splitter, width persisted per session), DataTable on the right.
- Content pane has a breadcrumb header at depth ≥ 2 (`programs / terms / sections / meetings / attendance`) with every crumb clickable, cheap navigation back up.

**Rail behaviour:**

- Tree with expand/collapse chevrons on parent nodes. Default: all expanded.
- Each node shows `label` + row/col count chip; at deep nesting (depth ≥ 3) also shows the shortened path.
- Indentation caps at ~5 levels of pixel-indent; beyond that the tree stays semantic but the indent freezes and the dotted-path column takes over as the primary identifier. Tooltips carry the full path.
- Degenerate guardrail: if the algorithm emits more than 50 tables, the rail shows the top 50 and a `"… N more — filter to find"` row with a filter input above the rail. Filter matches on path substrings.

**Decomposition algorithm** — see the [Algorithm](#algorithm) section.

### Raw tab

- **Pretty-print** always-on when `Content-Type` starts with `application/json`; a one-click toggle flips to verbatim source (for copy-paste fidelity against upstream systems).
- **Syntax highlighting** via a tiny custom JSON tokenizer in `highlight.ts` (no library — keeps the bundle lean). Token classes: `key`, `string`, `number`, `boolean`, `null`, `punct`. CSS colours use theme tokens so phosphor / amber / dos / beige all render consistently.
- **Line numbers** off by default; toggle in the tab header.
- **Find-in-page**: delegate to the browser's native `Ctrl+F`. No custom search UI.
- **Large-body head-slice**: if body > 1 MB, render only the first 64 KB by default with a `"Show all (N MB)"` expand button. Prevents paint freeze on pathologically large responses.
- **Copy** button in the tab header copies the body as-is (respects the pretty-print toggle).
- **Non-JSON bodies**: render as plaintext with no highlighting. Binary bodies render a hex head (first 512 bytes) + `"Binary — N bytes"` note.

### Headers tab

- Two sections stacked: **Response headers** (above) and **Request headers** (below, collapsible, default collapsed — users overwhelmingly care about response).
- `dl`-grid layout, monospace, sorted by header name ascending within each section.
- **Redact-by-default** for `Authorization`, `Cookie`, `Set-Cookie` — value replaced by a click-to-reveal chip consistent with how the Environments panel reveals API keys.
- **Copy** buttons: one per section (copies as `Name: Value\n` block), one per row (copies value only).

### Timing tab

Driven by the extended proxy response (see [Proxy change](#proxy-side-change)).

- Four horizontal bars, styled using theme tokens:
  - **Auth** — time spent in JWT exchange (0 ms on cache hit)
  - **Request** — `fetch()` start → response-headers-arrived (TTFB)
  - **Response** — headers-arrived → body download complete
  - **Total** — sum
- Numeric ms labels beside each bar.
- Footer line: `req: 432 B · resp: 18.3 KB` for quick bytes read.

## Panel states

| State | What renders |
|---|---|
| No send yet | `<ResponseEmpty />` — short hint + `F5 to send` reminder |
| In flight | Thin amber progress bar in the status row; tabs disabled; previous response (if any) stays visible beneath until the new one lands (prevents flicker) |
| Success, JSON body | All four tabs active; Table tab selected by default |
| Success, non-JSON (HTML / text / binary) | Table tab shows "Not JSON — see Raw"; Raw shows plaintext or hex head; Headers + Timing normal |
| Success, empty body (`204`) | All tabs render empty states; status shows `204` |
| Proxy error (our 5xx with `{error, detail}` JSON) | Red banner in status row (parity with today's ResponseStub); tabs still render the payload |
| Aborted (new send supersedes) | Silent — the new send's pending state replaces it |

**Tab-selection persistence:** component-local state; survives new sends in the session; resets only if the previously-selected tab is invalid for the new shape (e.g. Table on a JSON array → non-JSON body makes Raw the new default).

## Algorithm

### Decomposition contract

Every JSON response lands in one of these buckets. No data is lost; worst case everything flows through to Raw tab.

| Root shape | Table tab renders |
|---|---|
| `null` / scalar / non-JSON body (HTML, plaintext, binary) | Empty state: "Not tabular — see Raw tab" |
| `[]` | "Empty array" (0-row / 0-column table, still emitted) |
| `{}` | "Empty object" |
| `[scalar, scalar, ...]` | One table, 1 column `value` |
| `[{...}, {...}]` (array of objects) | One table, columns = union of keys |
| Array with mixed kinds `[obj, arr, scalar]` | Split by contiguous runs of same kind; one peer table per run |
| `{ scalar fields only }` | 2-column key/value table |
| `{ scalar fields + array fields }` | Primary table with scalar fields + one peer table per array field |
| `{ one array-of-objects value }` (e.g. `{ data: [...] }`) | Single-wrapper collapse: skip the wrapper level, promote the array |
| Nested arrays `[[...], [...]]` | Recurse into each; each terminal array-of-objects becomes its own peer table with its JSON path |
| Deep nesting | Recursive emission with `_parent_id` joins — no depth cap |

### Type contract

```ts
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

type DecomposedTable = {
  path: string;                // "$", "$.data", "$[*].emails", "$[0][2][*].x"
  parentPath: string | null;   // null for root; otherwise the emitting parent's path
  label: string;               // last segment for rail display: "emails", "testShape", "root"
  depth: number;               // 0-based; drives rail indent
  rows: Row[];
  columns: Column[];           // ordered: synthetic _parent_id / _idx first, then alphabetical
};

type Column = {
  key: string;                 // "academicLevel.id", "_parent_id", "_idx", or bracket-escaped
  kind: "scalar" | "dotted" | "synthetic" | "nested-chip" | "count-link";
  synthNote?: string;          // tooltip for _parent_idx fallback
};

type Row = { [columnKey: string]: CellValue };

type CellValue =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "chip-array"; count: number; jumpPath: string }       // array of scalars or mixed
  | { kind: "chip-object"; keyCount: number; jumpPath: string }   // object too deep to flatten
  | { kind: "count-link"; count: number; targetTablePath: string }; // points to peer table
```

### Pseudocode

```
decompose(root: Json): DecomposedTable[]
  tables = []
  effectiveRoot, rootPath = collapseWrapper(root, "$")
  emitTableFor(effectiveRoot, rootPath, null, labelFor(rootPath), 0, tables)
  return tables

collapseWrapper(root, path):
  // If root is { key: [array-of-objects] } with no other fields, skip one level.
  // Handles { data: [...] } / { items: [...] } / { results: [...] } etc.
  if isObject(root) and keys(root).length === 1 and isArrayOfObjects(root[onlyKey(root)]):
    k = onlyKey(root)
    return [root[k], path + "." + k]
  return [root, path]

emitTableFor(node, path, parentPath, label, depth, tables):
  rows = []
  columns = columnBuilder()

  if parentPath !== null:
    columns.addSynthetic("_parent_id" | "_parent_idx")

  if isArray(node):
    node.forEach((item, i) => rowFor(item, path + "[" + i + "]", i, rows, columns, path, tables, depth))
  elif isObject(node):
    rowFor(node, path, 0, rows, columns, path, tables, depth)   // single-row object table

  tables.push({ path, parentPath, label, depth, rows, columns: columns.finalize() })

rowFor(item, itemPath, idx, rows, columns, currentTablePath, tables, currentDepth):
  row = {}

  if isArray(item):
    // Row is itself an array → recurse as its own child table at itemPath.
    emitTableFor(item, itemPath, currentTablePath, segmentOf(itemPath), currentDepth + 1, tables)
    columns.ensure("_idx", "synthetic")
    columns.ensure(segmentOf(itemPath), "count-link")
    row["_idx"] = idx
    row[segmentOf(itemPath)] = { kind: "count-link", count: item.length, targetTablePath: itemPath }
  elif !isObject(item):
    // Array-of-scalars case.
    columns.ensure("value", "scalar")
    row["value"] = { kind: "scalar", value: item }
  else:
    flattenObject(item, "", row, columns, itemPath, tables, 0, currentDepth)
    // Pass-through wrapper guard: object had only array fields → force _idx so the row is anchorable.
    if row has only count-link columns:
      columns.ensureFirst("_idx", "synthetic")
      row["_idx"] = idx

  if parent exists:
    row["_parent_id"] = parentScalarIdOf(...) || idx

  rows.push(row)

flattenObject(obj, prefix, row, columns, parentPath, tables, flattenDepth, currentTreeDepth):
  for (k, v) of obj:
    col = prefix ? prefix + "." + k : k
    if isScalar(v):
      columns.ensure(col, prefix ? "dotted" : "scalar")
      row[col] = { kind: "scalar", value: v }
    elif isObject(v):
      if flattenDepth < 2:               // flatten up to dotted depth 3 (0, 1, 2)
        flattenObject(v, col, row, columns, parentPath, tables, flattenDepth + 1, currentTreeDepth)
      else:
        columns.ensure(col, "nested-chip")
        row[col] = { kind: "chip-object", keyCount: keys(v).length, jumpPath: parentPath + "." + col }
    elif isArray(v):
      if isArrayOfObjects(v) or isArrayOfArrays(v):
        childPath = parentPath + "." + col
        emitTableFor(v, childPath, parentPath, col, currentTreeDepth + 1, tables)
        columns.ensure(col, "count-link")
        row[col] = { kind: "count-link", count: v.length, targetTablePath: childPath }
      else:
        columns.ensure(col, "nested-chip")
        row[col] = { kind: "chip-array", count: v.length, jumpPath: parentPath + "." + col }
```

### Classification helpers

```
isArrayOfObjects(arr): arr.length > 0 AND every element is a plain object
isArrayOfScalars(arr): every element is scalar (possibly null)
isArrayOfArrays(arr):  every element is an array
isObject(v):           typeof v === "object" AND v !== null AND !Array.isArray(v)
isScalar(v):           v === null OR typeof v ∈ {string, number, boolean}
```

### Edge case rules

- **Heterogeneous array** (`[obj, arr, scalar, obj]`) — split by contiguous runs of same kind; emit each run as its own peer table with a display-only range path (`$[0..1]`, `$[2]`, `$[3]`). The `[a..b]` range notation is our internal convention for rail labels — it is not a standard JSONPath expression.
- **Empty array** — emit a 0-row, 0-column table so the schema slot is visible in the rail.
- **Empty object** — emit a 0-row, 0-column table.
- **Keys with dots** — bracket-escape in path and column key: `$.["my.odd.key"]` / column `["my.odd.key"]`. Prevents collision with dotted-flatten.
- **Wide union** (> 30 columns on one table) — show first 20 + a `"+M more columns"` chip that expands the full list.
- **Long string values** — truncate at 80 chars in-cell with a tooltip + click-to-expand.
- **Huge arrays** (> 1000 rows) — virtualise the DataTable (render visible window only, ~30-row overscan).
- **Cycles** — impossible in JSON-over-the-wire; not handled.

### `_parent_id` semantics

- Priority order for real IDs: `id` → `guid` → `code` → `key` → first scalar string field whose name ends in `Id` / `Code`.
- Fallback when none present: `_parent_idx` = integer row index into the parent table.
- Synthesised columns carry `kind: "synthetic"` and a `synthNote` tooltip (`"Row index of parent — no scalar id found"`).
- Root tables never get a `_parent_id` column.
- **Resolution timing:** the `_parent_id` *value* is resolved at the parent row's emission time and passed explicitly into the child's `emitTableFor(..., parentRowId)` call. Every row in that child table carries the same `_parent_id` (the one identifying the parent row that spawned it). This is why the same `_parent_id` repeats across child rows originating from the same parent row.

### Render targets (DataTable cell rendering)

| CellValue kind | Renders as |
|---|---|
| `scalar` | Value text; `null` dim; long strings truncated at 80 chars + tooltip + click-to-expand |
| `chip-array` | `[N]` chip; click → Raw tab scrolled to `jumpPath` |
| `chip-object` | `{N}` chip; click → Raw tab scrolled to `jumpPath` |
| `count-link` | `→ N rows` chip; click → rail selects `targetTablePath`, content pane swaps |

## Proxy-side change

Extension to `server/proxy/ethos.ts` (and `server/auth/ethos.ts` for the Auth phase). The existing `{ status, statusText, durationMs, headers, body }` shape gains two fields:

```ts
type ResponseTimings = {
  authMs: number;     // 0 when JWT cache-hit, else time in getOrExchangeJwt()
  requestMs: number;  // fetch() start → response headers arrived (TTFB)
  responseMs: number; // response headers arrived → .text() complete (body transfer)
  totalMs: number;    // authMs + requestMs + responseMs + small overhead
};

type ResponseBytes = {
  requestBytes: number;   // Content-Length sent, or computed from body string
  responseBytes: number;  // bodyText.length (UTF-8 byte length)
};
```

Implementation split:

```ts
const reqStart = performance.now();
const resp = await fetch(upstream, { ..., signal });
const requestMs = performance.now() - reqStart;
const bodyStart = performance.now();
const body = await resp.text();
const responseMs = performance.now() - bodyStart;
```

`getOrExchangeJwt` returns `{ jwt, authMs }` instead of bare `jwt`. Cache-hit paths return `authMs: 0`.

`durationMs` stays in the response shape for backwards compatibility; derived as `authMs + requestMs + responseMs`.

Abort: client-side `AbortController.signal` is passed through into `fetch`. Aborted requests surface as a sentinel result the client silently discards.

## Testing

### Unit — `web/docs/response/shape.test.ts`

Exhaustive, pure, no DOM. One test per row of the decomposition contract table plus notable edge cases:

- `scalar_root`, `null_root`
- `empty_array`, `empty_object`
- `array_of_scalars` → 1 col `value`
- `array_of_objects_simple`
- `object_with_only_scalars` → KV table
- `object_collapses_wrapper` — `{ data: [...] }` → primary is the array
- `object_no_collapse_wrapper` — `{ data: [...], meta: {...} }` → primary + peer, wrapper not collapsed
- `nested_one_level` — the academicLevels/testShape case from brainstorming
- `nested_five_levels` — programs → terms → sections → meetings → attendance
- `array_of_arrays`
- `heterogeneous_array` — split by runs
- `pass_through_wrapper_row` — object with only array fields → `_idx` synthesized
- `parent_id_priority` — `id` wins, falls back to `_parent_idx`
- `dotted_flatten_depth_3` — 4-deep object flattens 3 and chips the 4th
- `keys_with_dots` — bracket-escaped safely
- `wide_union` (> 30 cols) — ordered + `more-columns` flag
- `error_response_shape` — `{ error, detail }` → 2-col scalar KV

Target: ~25 tests, all < 5 ms each.

### Component — `tests/response-panel.test.ts`

Svelte component tests using happy-dom (Bun test already configured). Cases:

- Empty response prop → `<ResponseEmpty />` renders.
- JSON root array → TableTab active, no rail, DataTable with correct headers + rows.
- Deep nested shape → TableRail tree indents render correctly; chevron expand/collapse toggles visibility.
- 204 / 304 → appropriate empty states per tab.
- Non-JSON body → Table tab falls back with jump-to-Raw hint; Raw shows plaintext.
- Proxy error JSON → banner renders; payload still rendered in Raw.

Fallback if happy-dom is flaky on Windows: extract heavy logic to `shape.ts` + `highlight.ts` (already planned) and cover with pure tests; add a single Playwright smoke covering the panel end-to-end.

### Proxy — extend `tests/ethos-proxy.test.ts`

Four additional cases:

- Cache-hit JWT → `authMs === 0`.
- Cache-miss JWT → `authMs > 0` and flows through to the final response.
- TTFB (`requestMs`) and transfer (`responseMs`) both measured non-zero on an artificially slow fixture.
- `requestBytes` / `responseBytes` match body lengths.

### Try panel — new `tests/try-panel-abort.test.ts`

One test: clicking Send twice in quick succession aborts the first fetch. Stall fixture: Bun.serve handler holds the first request until the second arrives; assert the first promise rejects with `DOMException("aborted")` and the UI only renders the second response.

## File manifest

### New

- `web/docs/response/ResponsePanel.svelte`
- `web/docs/response/tabs/TableTab.svelte`
- `web/docs/response/tabs/RawTab.svelte`
- `web/docs/response/tabs/HeadersTab.svelte`
- `web/docs/response/tabs/TimingTab.svelte`
- `web/docs/response/TableRail.svelte`
- `web/docs/response/DataTable.svelte`
- `web/docs/response/ResponseEmpty.svelte`
- `web/docs/response/shape.ts`
- `web/docs/response/shape.test.ts`
- `web/docs/response/highlight.ts`
- `web/docs/response/types.ts`
- `tests/response-panel.test.ts`
- `tests/try-panel-abort.test.ts`
- `docs/superpowers/specs/2026-04-24-response-panel-design.md` (this file)

### Modified

- `web/App.svelte` — `currentResponse` + `sendCtl` state, replace response-snippet placeholder, wire TryPanel callbacks.
- `web/docs/TryPanel.svelte` — remove inline ResponseStub render + `response` local state; accept `onSend` / `onAbort` props; use AbortController on Send.
- `server/proxy/ethos.ts` — add `timings` + `bytes` to response contract (~15 lines).
- `server/auth/ethos.ts` — `getOrExchangeJwt` returns `{ jwt, authMs }`.
- `tests/ethos-proxy.test.ts` — four new cases as above.

### Deleted

- `web/docs/try/ResponseStub.svelte` — replaced by ResponsePanel (strict superset).

## Estimated size

- New code: ~900 LOC including tests.
- Modified: ~60 LOC.
- Deleted: ~90 LOC.

Most new weight is in `shape.ts` (~150 LOC + ~400 LOC of tests), `DataTable.svelte` (~200 LOC), and `TableTab.svelte` (~150 LOC). The remaining Svelte components are thin.
