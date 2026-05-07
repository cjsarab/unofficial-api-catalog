# Response Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Response Panel for Phase 2 item 6 — four tabs (Raw · Table · Headers · Timing) in the Shell's bottom slot, with algorithmic decomposition of JSON bodies into flat peer tables for the PL/SQL-veteran audience.

**Architecture:** One pure-TS decomposition library (`web/docs/response/shape.ts`) TDD'd against an exhaustive shape contract. One pure-TS JSON tokenizer (`highlight.ts`) TDD'd for Raw-tab syntax highlighting. Six Svelte 5 components under `web/docs/response/`. State lifted from TryPanel up to App.svelte with a single `AbortController` for cancel-previous concurrency. Tiny proxy-side change: `X-Proxy-Auth-Ms / -Request-Ms / -Response-Ms / -Request-Bytes / -Response-Bytes` response headers driven by a phase-split in the existing fetch path + an `authMs` return from `getOrExchangeJwt`.

**Tech Stack:** Bun 1.1+, TypeScript, Svelte 5 (runes: `$state` / `$props` / `$derived` / `{@render}`), `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-24-response-panel-design.md`.

**Testing policy:** Svelte component tests are not set up in this repo and adding happy-dom is deferred (would be its own scope). Every pure-TS unit (`shape.ts`, `highlight.ts`, proxy timing) is TDD'd with `bun:test`. Svelte components are validated via `bun run typecheck` and a manual smoke at the end of the plan. This matches how the Try panel (ref: `docs/superpowers/plans/2026-04-23-try-panel.md`) was built.

---

## File structure

**Create:**
- `web/docs/response/types.ts` — shared contracts (`ResponseView`, `DecomposedTable`, `Column`, `Row`, `CellValue`, `ResponseTimings`, `ResponseBytes`).
- `web/docs/response/shape.ts` — pure decomposition algorithm.
- `web/docs/response/shape.test.ts` — exhaustive shape-contract tests.
- `web/docs/response/highlight.ts` — minimal JSON tokenizer → span objects.
- `web/docs/response/highlight.test.ts` — tokenizer tests.
- `web/docs/response/ResponsePanel.svelte` — shell: status row + tab strip + tab content routing.
- `web/docs/response/ResponseEmpty.svelte` — "no send yet" placeholder.
- `web/docs/response/DataTable.svelte` — renders one `DecomposedTable` as a flat grid with cell-type rendering.
- `web/docs/response/TableRail.svelte` — tree rail for multi-table mode.
- `web/docs/response/tabs/TableTab.svelte` — orchestrates decomposition + rail + DataTable + breadcrumb + single-table collapse.
- `web/docs/response/tabs/RawTab.svelte` — pretty-print, syntax highlight, copy, head-slice.
- `web/docs/response/tabs/HeadersTab.svelte` — response + request sections with redact-chips.
- `web/docs/response/tabs/TimingTab.svelte` — phase bars + bytes summary.

**Modify:**
- `server/auth/ethos.ts` — `TokenCache.getJwt` returns `{ jwt, authMs }`.
- `server/proxy/ethos.ts` — phase-split fetch; set `X-Proxy-*` response headers; use `authMs` from the token cache.
- `tests/ethos-auth.test.ts` — assert `authMs` is reported correctly on cache-hit + cache-miss.
- `tests/ethos-proxy.test.ts` — assert response headers carry the phase breakdown.
- `web/docs/TryPanel.svelte` — remove inline `ResponseStub`, accept `onSend` / `onAbort` props, AbortController, parse proxy timing headers, build `ResponseView`.
- `web/App.svelte` — own `currentResponse` + `sendCtl` state, wire `onSend` / `onAbort` / `onclear`, render `<ResponsePanel>` in the `response` snippet.

**Delete:**
- `web/docs/try/ResponseStub.svelte` — strictly superseded by ResponsePanel.

---

## Task 1: Proxy phase timings + response headers

Adds `authMs` / `requestMs` / `responseMs` / `requestBytes` / `responseBytes` to every response the proxy returns, via `X-Proxy-*` headers. TDD'd.

**Files:**
- Modify: `server/auth/ethos.ts`
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-auth.test.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Add a failing test for `authMs` in `ethos-auth.test.ts`**

Locate the existing first test (e.g. "happy path — exchanges API key for JWT"). Copy it and add two new tests below. Open `tests/ethos-auth.test.ts` and append these tests inside the existing `describe("createTokenCache", ...)` block (or whatever the top-level `describe` is named — match the existing label exactly):

```ts
test("authMs: non-zero on cache miss, zero on cache hit", async () => {
  const { tokenCache, authHits } = await setup();   // use the existing fixture helper
  const first = await tokenCache.getJwt(envId);
  expect(first.jwt).toBeDefined();
  expect(first.authMs).toBeGreaterThan(0);
  expect(authHits).toBe(1);

  const second = await tokenCache.getJwt(envId);
  expect(second.jwt).toBe(first.jwt);
  expect(second.authMs).toBe(0);
  expect(authHits).toBe(1);                         // still 1 — cache hit, no fresh fetch
});
```

**Note for the implementer:** if the existing tests destructure a plain string from `getJwt` (e.g. `const jwt = await tokenCache.getJwt(envId)`), update them to the new shape:

```ts
const { jwt } = await tokenCache.getJwt(envId);
```

Do this **only for the tests already in the file** — leave the new tests using the full `{ jwt, authMs }` shape.

- [ ] **Step 2: Run the new test — expect it to fail**

Run: `./bun.exe test tests/ethos-auth.test.ts -t "authMs"`
Expected: FAIL with something like "Property 'authMs' does not exist on type 'string'" or a runtime assertion.

- [ ] **Step 3: Change `TokenCache.getJwt` to return `{ jwt, authMs }`**

Edit `server/auth/ethos.ts`:

```ts
export interface TokenCache {
  /** Returns a valid JWT for the given env. Also reports how long the fetch took (0 on cache hit). */
  getJwt(envId: string): Promise<{ jwt: string; authMs: number }>;
  /** Drops the cached JWT for the given env. Next getJwt forces a fresh fetch. */
  invalidate(envId: string): void;
}
```

Replace the `return { async getJwt(envId) { ... } ... }` block with:

```ts
return {
  async getJwt(envId) {
    const hit = cache.get(envId);
    if (hit && hit.expiresAt > Date.now()) return { jwt: hit.jwt, authMs: 0 };
    const t0 = performance.now();
    const jwt = await fetchFresh(envId);
    return { jwt, authMs: Math.round(performance.now() - t0) };
  },
  invalidate(envId) {
    cache.delete(envId);
  },
};
```

- [ ] **Step 4: Update the single caller in `server/proxy/ethos.ts`**

Find:
```ts
const jwt = await opts.tokenCache.getJwt(activeId);
```
and change it to:
```ts
const { jwt, authMs } = await opts.tokenCache.getJwt(activeId);
```

Also — `attempt()` currently returns `{ res, outgoing }`. Extend to `{ res, outgoing, authMs }` so the outer handler can accumulate across retry:

```ts
async function attempt(): Promise<{ res: Response; outgoing: Headers; authMs: number }> {
  const { jwt, authMs } = await opts.tokenCache.getJwt(activeId);
  const hdrs = new Headers(baseHeaders);
  hdrs.set("Authorization", `Bearer ${jwt}`);
  const res = await fetch(upstreamUrl, {
    method: req.method,
    headers: hdrs,
    body: incomingBody ?? undefined,
  });
  return { res, outgoing: hdrs, authMs };
}
```

- [ ] **Step 5: Run the auth tests — expect pass**

Run: `./bun.exe test tests/ethos-auth.test.ts`
Expected: all pass, including the new `authMs` test.

- [ ] **Step 6: Add failing tests for the proxy's `X-Proxy-*` response headers**

Open `tests/ethos-proxy.test.ts` and append inside the existing `describe("ethos request proxy", ...)` block:

```ts
test("proxy response headers carry phase timings + byte counts", async () => {
  upstream.respondWith = () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  const res = await sendThroughProxy("GET", "/persons");
  expect(res!.status).toBe(200);

  // Numeric and present.
  const auth = Number(res!.headers.get("X-Proxy-Auth-Ms"));
  const requestMs = Number(res!.headers.get("X-Proxy-Request-Ms"));
  const responseMs = Number(res!.headers.get("X-Proxy-Response-Ms"));
  const reqBytes = Number(res!.headers.get("X-Proxy-Request-Bytes"));
  const respBytes = Number(res!.headers.get("X-Proxy-Response-Bytes"));

  expect(Number.isFinite(auth)).toBe(true);
  expect(Number.isFinite(requestMs)).toBe(true);
  expect(Number.isFinite(responseMs)).toBe(true);
  expect(requestMs).toBeGreaterThanOrEqual(0);
  expect(responseMs).toBeGreaterThanOrEqual(0);

  // Bytes: request had no body, response body was {"ok":true} = 11 UTF-8 bytes.
  expect(reqBytes).toBe(0);
  expect(respBytes).toBe(11);
});
```

**Note for the implementer:** `sendThroughProxy` is the helper already used by the existing proxy tests; match its signature. If the file uses a different helper name, use that.

- [ ] **Step 7: Run the proxy test — expect it to fail**

Run: `./bun.exe test tests/ethos-proxy.test.ts -t "phase timings"`
Expected: FAIL — headers are `null`, so `Number(null)` yields `NaN` and `Number.isFinite(NaN)` is false.

- [ ] **Step 8: Implement the phase-split in `server/proxy/ethos.ts`**

Replace the existing `attempt()` body and the surrounding block that awaits `res.arrayBuffer()` to phase-split the fetch. Here is the full rewritten handler body (replaces lines ~114–183 in the current file — from `const incomingBody = …` through the final `return new Response(…)`):

```ts
const incomingBody = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
const upstreamUrl = `${opts.baseUrlGetter()}${path}`;
const baseHeaders = filterIncomingHeaders(req.headers);
const startedAt = performance.now();

async function attempt(): Promise<{
  res: Response; outgoing: Headers; authMs: number; requestMs: number;
}> {
  const { jwt, authMs } = await opts.tokenCache.getJwt(activeId);
  const hdrs = new Headers(baseHeaders);
  hdrs.set("Authorization", `Bearer ${jwt}`);
  const reqStart = performance.now();
  const res = await fetch(upstreamUrl, {
    method: req.method,
    headers: hdrs,
    body: incomingBody ?? undefined,
  });
  const requestMs = Math.round(performance.now() - reqStart);
  return { res, outgoing: hdrs, authMs, requestMs };
}

let first: { res: Response; outgoing: Headers; authMs: number; requestMs: number };
try {
  first = await attempt();
} catch (err) {
  return classifyFetchError(err);
}
let finalAttempt = first;
let retried = false;
const upstreamStatus = first.res.status;

// Accumulate auth time across retry — the one-shot refresh is itself a network hop worth reporting.
let totalAuthMs = first.authMs;
let totalRequestMs = first.requestMs;

if (first.res.status === 401) {
  await first.res.arrayBuffer().catch(() => undefined);
  opts.tokenCache.invalidate(activeId);
  try {
    finalAttempt = await attempt();
    retried = true;
    totalAuthMs += finalAttempt.authMs;
    totalRequestMs += finalAttempt.requestMs;
  } catch (err) {
    return classifyFetchError(err);
  }
}

const bodyStart = performance.now();
const responseBytes = new Uint8Array(await finalAttempt.res.arrayBuffer());
const responseMs = Math.round(performance.now() - bodyStart);
const durationMs = performance.now() - startedAt;

const event: ProxyCompleteEvent = {
  envId: activeId,
  method: req.method,
  path,
  upstreamUrl,
  requestHeaders: headersToObject(finalAttempt.outgoing, true),
  requestBody: incomingBody,
  status: finalAttempt.res.status,
  upstreamStatus,
  responseHeaders: headersToObject(finalAttempt.res.headers, false),
  responseBody: responseBytes,
  durationMs,
  retried,
};

if (opts.onComplete) {
  try {
    const maybe = opts.onComplete(event);
    if (maybe instanceof Promise) maybe.catch(() => { /* swallow — hook errors must not crash the proxy */ });
  } catch {
    // sync hook throw — also swallow.
  }
}

const outHeaders = shapeResponseHeaders(finalAttempt.res.headers, upstreamStatus);
outHeaders.set("X-Proxy-Auth-Ms", String(totalAuthMs));
outHeaders.set("X-Proxy-Request-Ms", String(totalRequestMs));
outHeaders.set("X-Proxy-Response-Ms", String(responseMs));
outHeaders.set("X-Proxy-Request-Bytes", String(incomingBody?.byteLength ?? 0));
outHeaders.set("X-Proxy-Response-Bytes", String(responseBytes.byteLength));

return new Response(responseBytes, {
  status: finalAttempt.res.status,
  headers: outHeaders,
});
```

- [ ] **Step 9: Run the proxy test suite — expect pass**

Run: `./bun.exe test tests/ethos-proxy.test.ts`
Expected: all pass, including the new "phase timings + byte counts" test.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `./bun.exe test && ./bun.exe run typecheck`
Expected: 129 + N new tests pass; typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add server/auth/ethos.ts server/proxy/ethos.ts tests/ethos-auth.test.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat(proxy): expose phase timings + byte counts via X-Proxy-* headers

TokenCache.getJwt now returns { jwt, authMs } (0 on cache hit). The proxy
splits its fetch into TTFB + transfer phases and emits five response
headers: X-Proxy-Auth-Ms / -Request-Ms / -Response-Ms / -Request-Bytes /
-Response-Bytes. Drives the Response Panel's Timing tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Response contract types

Defines the shared type surface the whole panel trades against. No logic.

**Files:**
- Create: `web/docs/response/types.ts`

- [ ] **Step 1: Write `web/docs/response/types.ts`**

```ts
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
  | { kind: "count-link"; count: number; targetTablePath: string };

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
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/types.ts
git commit -m "$(cat <<'EOF'
feat(response): shared type contracts for the Response Panel

ResponseView flows from TryPanel into App.svelte; DecomposedTable
drives the Table tab's rail + DataTable rendering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Shape decomposition — basics + classification helpers

First slice of `shape.ts`. TDD'd: null / scalar / empty array / empty object / array-of-scalars / single-level array-of-objects.

**Files:**
- Create: `web/docs/response/shape.ts`
- Create: `web/docs/response/shape.test.ts`

- [ ] **Step 1: Write `shape.test.ts` with the first six shape cases (failing)**

```ts
import { describe, expect, test } from "bun:test";
import { decompose } from "./shape.ts";
import type { DecomposedTable } from "./types.ts";

function paths(tables: DecomposedTable[]): string[] {
  return tables.map((t) => t.path);
}

describe("shape.decompose — basics", () => {
  test("scalar_root", () => {
    expect(decompose("hello")).toEqual([]);
    expect(decompose(42 as never)).toEqual([]);
    expect(decompose(true as never)).toEqual([]);
  });

  test("null_root", () => {
    expect(decompose(null)).toEqual([]);
  });

  test("empty_array", () => {
    const tables = decompose([]);
    expect(tables).toHaveLength(1);
    expect(tables[0].path).toBe("$");
    expect(tables[0].rows).toEqual([]);
    expect(tables[0].columns).toEqual([]);
  });

  test("empty_object", () => {
    const tables = decompose({});
    expect(tables).toHaveLength(1);
    expect(tables[0].path).toBe("$");
    expect(tables[0].rows).toEqual([]);
    expect(tables[0].columns).toEqual([]);
  });

  test("array_of_scalars", () => {
    const tables = decompose([1, 2, "three"]);
    expect(tables).toHaveLength(1);
    expect(tables[0].path).toBe("$");
    expect(tables[0].columns.map((c) => c.key)).toEqual(["value"]);
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[0].rows[0]["value"]).toEqual({ kind: "scalar", value: 1 });
    expect(tables[0].rows[2]["value"]).toEqual({ kind: "scalar", value: "three" });
  });

  test("array_of_objects_simple", () => {
    const tables = decompose([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ]);
    expect(tables).toHaveLength(1);
    expect(tables[0].columns.map((c) => c.key)).toEqual(["id", "name"]);
    expect(tables[0].rows[0]["name"]).toEqual({ kind: "scalar", value: "Alice" });
  });

  test("object_with_only_scalars yields a single-row KV table", () => {
    const tables = decompose({ id: "a", code: "CS", active: true });
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].columns.map((c) => c.key)).toEqual(["active", "code", "id"]); // alphabetical
    expect(tables[0].rows[0]["id"]).toEqual({ kind: "scalar", value: "a" });
  });
});
```

- [ ] **Step 2: Run the tests — expect all six to fail**

Run: `./bun.exe test tests/shape.test.ts` — wait, the test lives under `web/docs/response/`. `bun:test` picks up `**/*.test.ts` by default, including inside `web/`. Run:

`./bun.exe test web/docs/response/shape.test.ts`
Expected: fails at import (shape.ts doesn't exist yet).

- [ ] **Step 3: Write the minimal `shape.ts` that passes the six tests**

```ts
// web/docs/response/shape.ts
//
// Pure decomposition: parsed JSON → ordered list of flat peer tables.
// See docs/superpowers/specs/2026-04-24-response-panel-design.md for the contract.

import type {
  CellValue,
  Column,
  ColumnKind,
  DecomposedTable,
  Json,
  Row,
} from "./types.ts";

// --- classification helpers -------------------------------------------------

export function isScalar(v: Json): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function isObject(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: Json): v is Json[] {
  return Array.isArray(v);
}

function isArrayOfObjects(v: Json): boolean {
  return isArray(v) && v.length > 0 && v.every(isObject);
}

// --- column builder ---------------------------------------------------------
//
// Columns are kept in insertion order during the walk, then reordered on
// finalize() so synthetic columns lead and the rest are alphabetical.
// Required because the union of keys across heterogeneous rows is data-driven.

function makeColumnBuilder() {
  const map = new Map<string, Column>();
  return {
    ensure(key: string, kind: ColumnKind, synthNote?: string) {
      if (!map.has(key)) map.set(key, { key, kind, synthNote });
    },
    finalize(): Column[] {
      const synthetic: Column[] = [];
      const rest: Column[] = [];
      for (const col of map.values()) {
        if (col.kind === "synthetic") synthetic.push(col);
        else rest.push(col);
      }
      rest.sort((a, b) => a.key.localeCompare(b.key));
      // _parent_id / _parent_idx leads, then _idx, then the rest.
      synthetic.sort((a, b) => {
        const score = (k: string) =>
          k === "_parent_id" || k === "_parent_idx" ? 0 : k === "_idx" ? 1 : 2;
        return score(a.key) - score(b.key);
      });
      return [...synthetic, ...rest];
    },
  };
}

// --- main entry point -------------------------------------------------------

export function decompose(root: Json): DecomposedTable[] {
  if (isScalar(root)) return [];

  const tables: DecomposedTable[] = [];
  emitTableFor(root, "$", null, "root", 0, null, tables);
  return tables;
}

// --- core recursion ---------------------------------------------------------

function emitTableFor(
  node: Json,
  path: string,
  parentPath: string | null,
  label: string,
  depth: number,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
): void {
  const rows: Row[] = [];
  const cols = makeColumnBuilder();

  const parentIdKey = parentPath !== null
    ? (typeof parentRowId === "number" ? "_parent_idx" : "_parent_id")
    : null;

  if (parentIdKey) {
    cols.ensure(
      parentIdKey,
      "synthetic",
      parentIdKey === "_parent_idx"
        ? "Row index of parent — no scalar id found"
        : undefined,
    );
  }

  if (isArray(node)) {
    node.forEach((item, i) => {
      rowFor(item, `${path}[${i}]`, i, rows, cols, parentIdKey, parentRowId, path, tables, depth);
    });
  } else if (isObject(node)) {
    rowFor(node, path, 0, rows, cols, parentIdKey, parentRowId, path, tables, depth);
  }

  tables.push({
    path,
    parentPath,
    label,
    depth,
    rows,
    columns: cols.finalize(),
  });
}

function rowFor(
  item: Json,
  _itemPath: string,
  idx: number,
  rows: Row[],
  cols: ReturnType<typeof makeColumnBuilder>,
  parentIdKey: string | null,
  parentRowId: string | number | null,
  _currentTablePath: string,
  _tables: DecomposedTable[],
  _depth: number,
): void {
  const row: Row = {};

  if (isScalar(item)) {
    cols.ensure("value", "scalar");
    row["value"] = { kind: "scalar", value: item };
  } else if (isObject(item)) {
    for (const [k, v] of Object.entries(item)) {
      if (isScalar(v)) {
        cols.ensure(k, "scalar");
        row[k] = { kind: "scalar", value: v } satisfies CellValue;
      }
      // other kinds handled in later task
    }
  }

  if (parentIdKey) {
    row[parentIdKey] = { kind: "scalar", value: parentRowId } satisfies CellValue;
  }

  rows.push(row);
}
```

- [ ] **Step 4: Run the tests — expect all six to pass**

Run: `./bun.exe test web/docs/response/shape.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/docs/response/shape.ts web/docs/response/shape.test.ts
git commit -m "$(cat <<'EOF'
feat(response): shape.decompose — scalar/null/empty + array-of-scalars + array-of-objects basics

Classification helpers + column builder + root entry point. Covers six
of the contract's shape cases. Peer tables, dotted flatten, chips, and
_parent_id resolution land in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Shape decomposition — nested objects, dotted flatten, chips

Adds dotted-flatten (depth 3 budget) and chip emission for deeper objects and for scalar/mixed arrays.

**Files:**
- Modify: `web/docs/response/shape.ts`
- Modify: `web/docs/response/shape.test.ts`

- [ ] **Step 1: Append new failing tests in `shape.test.ts`**

Add a new `describe` block below the first:

```ts
describe("shape.decompose — flatten + chips", () => {
  test("dotted_flatten_depth_3: 3-deep object flattens, 4th level chips", () => {
    const tables = decompose([
      { a: { b: { c: { d: "deep" } } } },
    ]);
    const cols = tables[0].columns.map((c) => c.key);
    // a.b.c is the terminal column (flatten depth 3 = a -> a.b -> a.b.c). The 'd' key lives under c, past the budget.
    expect(cols).toEqual(["a.b.c"]);
    // Cell is a chip-object pointing at the remaining object { d: "deep" }.
    const cell = tables[0].rows[0]["a.b.c"];
    expect(cell.kind).toBe("chip-object");
    if (cell.kind === "chip-object") {
      expect(cell.keyCount).toBe(1);
      expect(cell.jumpPath).toBe("$[0].a.b.c");
    }
  });

  test("dotted_flatten: 2-deep object produces flat scalar columns (no chip)", () => {
    const tables = decompose([
      { outer: { inner: "X", deeper: 42 } },
    ]);
    const cols = tables[0].columns.map((c) => c.key);
    expect(cols).toEqual(["outer.deeper", "outer.inner"]);
    expect(tables[0].rows[0]["outer.inner"]).toEqual({ kind: "scalar", value: "X" });
    expect(tables[0].rows[0]["outer.deeper"]).toEqual({ kind: "scalar", value: 42 });
    expect(tables[0].columns.find((c) => c.key === "outer.inner")?.kind).toBe("dotted");
  });

  test("array_of_scalars_field becomes a chip-array in the row", () => {
    const tables = decompose([
      { id: "a", tags: ["red", "blue"] },
    ]);
    // Only one table — tags is scalars, stays in-row as chip-array.
    expect(tables).toHaveLength(1);
    const cell = tables[0].rows[0]["tags"];
    expect(cell.kind).toBe("chip-array");
    if (cell.kind === "chip-array") {
      expect(cell.count).toBe(2);
      expect(cell.jumpPath).toBe("$[0].tags");
    }
  });

  test("mixed_type_array_field is rendered as a chip-array", () => {
    const tables = decompose([
      { id: "a", mixed: [1, "two", { x: 3 }] },
    ]);
    expect(tables).toHaveLength(1); // mixed arrays don't become peer tables in this task
    const cell = tables[0].rows[0]["mixed"];
    expect(cell.kind).toBe("chip-array");
  });
});
```

- [ ] **Step 2: Run tests — expect the four to fail**

Run: `./bun.exe test web/docs/response/shape.test.ts -t "flatten + chips"`
Expected: FAIL — `rowFor` currently ignores object/array values.

- [ ] **Step 3: Extend `rowFor` to call a new `flattenObject` helper**

Replace the `isObject(item)` branch inside `rowFor` with:

```ts
} else if (isObject(item)) {
  flattenObject(item, "", row, cols, _itemPath, 0);
}
```

Then append the helper to `shape.ts`:

```ts
function flattenObject(
  obj: { [k: string]: Json },
  prefix: string,
  row: Row,
  cols: ReturnType<typeof makeColumnBuilder>,
  parentPath: string,
  flattenDepth: number,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const col = prefix ? `${prefix}.${k}` : k;
    if (isScalar(v)) {
      cols.ensure(col, prefix ? "dotted" : "scalar");
      row[col] = { kind: "scalar", value: v };
    } else if (isObject(v)) {
      if (flattenDepth < 2) {
        flattenObject(v, col, row, cols, parentPath, flattenDepth + 1);
      } else {
        cols.ensure(col, "nested-chip");
        row[col] = {
          kind: "chip-object",
          keyCount: Object.keys(v).length,
          jumpPath: `${parentPath}.${col}`,
        };
      }
    } else if (isArray(v)) {
      // Peer-table emission for array-of-objects lands in the next task; for now, treat every array as a chip.
      cols.ensure(col, "nested-chip");
      row[col] = {
        kind: "chip-array",
        count: v.length,
        jumpPath: `${parentPath}.${col}`,
      };
    }
  }
}
```

**Note:** the `flattenDepth < 2` check implements the "depth 3 budget" (0 = root, 1 = one level nested, 2 = two levels nested; depth 3 is where we chip).

- [ ] **Step 4: Run tests — expect all four new tests to pass**

Run: `./bun.exe test web/docs/response/shape.test.ts`
Expected: 10 pass (6 from task 3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add web/docs/response/shape.ts web/docs/response/shape.test.ts
git commit -m "$(cat <<'EOF'
feat(response): dotted flatten (depth 3) + chip fallback for arrays / deep objects

flattenObject flattens up to 3 dotted levels; deeper objects render as
chip-object, all arrays (in this task) render as chip-array. Peer-table
emission for array-of-objects lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Shape decomposition — peer tables, _parent_id, wrapper collapse, edge cases

The hardest piece. Emits child peer tables when an object field is array-of-objects or array-of-arrays, resolves _parent_id, collapses `{ data: [...] }` wrappers, synthesises _idx for pass-through wrappers, splits heterogeneous arrays by runs, handles 5-deep nesting, and covers wide-union truncation + dot-escaped keys.

**Files:**
- Modify: `web/docs/response/shape.ts`
- Modify: `web/docs/response/shape.test.ts`

- [ ] **Step 1: Append the final batch of tests**

```ts
describe("shape.decompose — peer tables + edge cases", () => {
  test("nested_one_level: object has array-of-objects field → peer table", () => {
    const tables = decompose([
      { id: "A", children: [{ n: 1 }, { n: 2 }] },
    ]);
    expect(paths(tables)).toEqual(["$", "$[*].children"]);
    // Parent table: id column + count-link to children.
    const parent = tables[0];
    expect(parent.columns.map((c) => c.key).sort()).toEqual(["children", "id"]);
    expect(parent.rows[0]["children"]).toEqual({
      kind: "count-link",
      count: 2,
      targetTablePath: "$[0].children",
    });
    // Peer: _parent_id = "A" (from scalar id) + n column.
    const peer = tables[1];
    expect(peer.columns.map((c) => c.key)).toEqual(["_parent_id", "n"]);
    expect(peer.rows[0]["_parent_id"]).toEqual({ kind: "scalar", value: "A" });
    expect(peer.rows[0]["n"]).toEqual({ kind: "scalar", value: 1 });
    expect(peer.depth).toBe(1);
  });

  test("_parent_idx fallback when parent has no scalar id", () => {
    const tables = decompose([
      { values: [{ n: 1 }] },
    ]);
    const peer = tables[1];
    // No id/guid/code/key on parent → synthesised _parent_idx.
    expect(peer.columns.map((c) => c.key)).toEqual(["_parent_idx", "n"]);
    expect(peer.rows[0]["_parent_idx"]).toEqual({ kind: "scalar", value: 0 });
    expect(peer.columns[0].synthNote).toBe("Row index of parent — no scalar id found");
  });

  test("parent_id_priority: id beats guid beats code beats key", () => {
    const tables = decompose([
      { guid: "G", code: "C", key: "K", id: "ID", items: [{ x: 1 }] },
    ]);
    expect(tables[1].rows[0]["_parent_id"]).toEqual({ kind: "scalar", value: "ID" });
  });

  test("object_collapses_wrapper: { data: [arrayOfObjects] } → single promoted table", () => {
    const tables = decompose({ data: [{ id: "a" }, { id: "b" }] });
    expect(tables).toHaveLength(1);
    expect(tables[0].path).toBe("$.data");
    expect(tables[0].rows).toHaveLength(2);
  });

  test("object_no_collapse_wrapper: { data: [...], meta: {...} } stays as primary + peer", () => {
    const tables = decompose({ data: [{ id: "a" }], meta: { total: 1 } });
    expect(paths(tables).sort()).toEqual(["$", "$.data"].sort());
    // Primary ($) has meta flattened + data as count-link.
    expect(tables[0].columns.map((c) => c.key).sort()).toEqual(["data", "meta.total"].sort());
  });

  test("pass_through_wrapper_row: object with only array fields gets _idx", () => {
    const tables = decompose([{ academicLevels: [{ priority: "primary" }] }]);
    // Primary: synthetic _idx + count-link for academicLevels.
    expect(tables[0].columns.map((c) => c.key)).toEqual(["_idx", "academicLevels"]);
    expect(tables[0].rows[0]["_idx"]).toEqual({ kind: "scalar", value: 0 });
    // Peer exists.
    expect(tables[1].path).toBe("$[0].academicLevels");
  });

  test("nested_five_levels: programs → terms → sections → meetings → attendance", () => {
    const tables = decompose([
      {
        code: "CS-BS",
        terms: [
          {
            termCode: "2026FA",
            sections: [
              {
                crn: "12345",
                meetings: [
                  {
                    day: "MW",
                    attendance: [
                      { date: "2026-09-01", count: 42 },
                      { date: "2026-09-03", count: 40 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(paths(tables)).toEqual([
      "$",
      "$[*].terms",
      "$[*].terms[*].sections",
      "$[*].terms[*].sections[*].meetings",
      "$[*].terms[*].sections[*].meetings[*].attendance",
    ]);
    // Depths are 0..4.
    expect(tables.map((t) => t.depth)).toEqual([0, 1, 2, 3, 4]);
    // Leaf table has 2 attendance rows.
    expect(tables[4].rows).toHaveLength(2);
    expect(tables[4].columns.map((c) => c.key).sort()).toEqual(["_parent_idx", "count", "date"]);
  });

  test("array_of_arrays at the root emits one peer table per inner array", () => {
    const tables = decompose([
      [{ a: 1 }, { a: 2 }],
      [{ a: 3 }],
    ]);
    // Primary table: row per outer item, each a count-link to its inner.
    expect(paths(tables)).toEqual(["$", "$[0]", "$[1]"]);
    expect(tables[0].rows[0][tables[0].columns.find((c) => c.kind === "count-link")!.key].kind).toBe("count-link");
  });

  test("heterogeneous_array splits into contiguous-run peer tables", () => {
    const tables = decompose([
      { a: 1 },
      { a: 2 },
      [{ b: 1 }],
      "scalar",
      { a: 3 },
    ]);
    // Primary $ retains nothing coherent; we split runs by kind.
    // Split into: $[0..1] (obj run), $[2] (arr), $[3] (scalar), $[4] (obj).
    const nonPrimary = tables.filter((t) => t.path !== "$");
    expect(nonPrimary.map((t) => t.path).sort()).toEqual(
      ["$[0..1]", "$[2]", "$[3]", "$[4]"].sort(),
    );
  });

  test("keys_with_dots are bracket-escaped in column keys and paths", () => {
    const tables = decompose([
      { "my.odd.key": "v", other: { "a.b": 1 } },
    ]);
    const cols = tables[0].columns.map((c) => c.key);
    expect(cols).toContain('["my.odd.key"]');
    // Nested dotted-flatten also escapes: column becomes other.["a.b"]
    expect(cols).toContain('other.["a.b"]');
  });

  test("wide_union truncates column display with hiddenColumnCount", () => {
    const row: Record<string, number> = {};
    for (let i = 0; i < 40; i++) row[`c${i.toString().padStart(2, "0")}`] = i;
    const tables = decompose([row]);
    expect(tables[0].hiddenColumnCount).toBe(20);
    expect(tables[0].columns).toHaveLength(20);
  });

  test("error_response_shape: { error, detail } → 2-col KV", () => {
    const tables = decompose({ error: "no-api-key", detail: "env 'x' has no key" });
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].columns.map((c) => c.key).sort()).toEqual(["detail", "error"]);
  });
});
```

- [ ] **Step 2: Run the tests — expect all 12 to fail**

Run: `./bun.exe test web/docs/response/shape.test.ts -t "peer tables"`
Expected: 12 failures.

- [ ] **Step 3: Rewrite `shape.ts` to handle peer tables + edge cases**

This is the final implementation. Replace the whole file with:

```ts
// web/docs/response/shape.ts
//
// Pure decomposition: parsed JSON → ordered list of flat peer tables.
// Contract lives in docs/superpowers/specs/2026-04-24-response-panel-design.md.

import type {
  CellValue,
  Column,
  ColumnKind,
  DecomposedTable,
  Json,
  Row,
} from "./types.ts";

// --- classification ---------------------------------------------------------

export function isScalar(v: Json): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function isObject(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: Json): v is Json[] {
  return Array.isArray(v);
}

function isArrayOfObjects(v: Json): boolean {
  return isArray(v) && v.length > 0 && v.every(isObject);
}

function isArrayOfArrays(v: Json): boolean {
  return isArray(v) && v.length > 0 && v.every((e) => isArray(e));
}

type ItemKind = "obj" | "arr" | "scalar";
function itemKind(v: Json): ItemKind {
  if (isArray(v)) return "arr";
  if (isObject(v)) return "obj";
  return "scalar";
}

// --- path helpers -----------------------------------------------------------

function escapeKey(k: string): string {
  return k.includes(".") || k.includes("[") || k.includes("]") ? `["${k}"]` : k;
}

function joinPath(parent: string, segment: string): string {
  if (segment.startsWith("[")) return parent + segment;
  return parent + "." + segment;
}

// --- column builder ---------------------------------------------------------

const MAX_COLUMNS = 20;

function makeColumnBuilder() {
  const map = new Map<string, Column>();
  return {
    ensure(key: string, kind: ColumnKind, synthNote?: string) {
      if (!map.has(key)) map.set(key, { key, kind, synthNote });
    },
    get size(): number {
      return map.size;
    },
    finalize(): { columns: Column[]; hiddenColumnCount?: number } {
      const synthetic: Column[] = [];
      const rest: Column[] = [];
      for (const col of map.values()) {
        if (col.kind === "synthetic") synthetic.push(col);
        else rest.push(col);
      }
      rest.sort((a, b) => a.key.localeCompare(b.key));
      synthetic.sort((a, b) => {
        const score = (k: string) =>
          k === "_parent_id" || k === "_parent_idx" ? 0 : k === "_idx" ? 1 : 2;
        return score(a.key) - score(b.key);
      });
      const all = [...synthetic, ...rest];
      if (all.length <= MAX_COLUMNS) return { columns: all };
      return {
        columns: all.slice(0, MAX_COLUMNS),
        hiddenColumnCount: all.length - MAX_COLUMNS,
      };
    },
  };
}

// --- parent-id resolution ---------------------------------------------------

const ID_PRIORITY = ["id", "guid", "code", "key"] as const;

function parentScalarIdOf(obj: { [k: string]: Json }): string | number | null {
  for (const k of ID_PRIORITY) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  // Secondary: first scalar-string field whose name ends in Id / Code (case-insensitive).
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    if (/(?:Id|Code)$/.test(k)) return v;
  }
  return null;
}

// --- main entry -------------------------------------------------------------

export function decompose(root: Json): DecomposedTable[] {
  if (isScalar(root)) return [];

  const tables: DecomposedTable[] = [];
  const [effectiveRoot, rootPath] = collapseWrapper(root);
  emitTableFor(effectiveRoot, rootPath, null, labelFor(rootPath), 0, null, tables);
  return tables;
}

function labelFor(path: string): string {
  if (path === "$") return "root";
  // Drop the leading "$." or "$" and return the last segment.
  const tail = path.replace(/^\$\.?/, "").replace(/\["([^"]+)"\]$/, "$1");
  const parts = tail.split(".");
  return parts[parts.length - 1] || "root";
}

function collapseWrapper(root: Json): [Json, string] {
  if (!isObject(root)) return [root, "$"];
  const keys = Object.keys(root);
  if (keys.length !== 1) return [root, "$"];
  const only = keys[0];
  if (!isArrayOfObjects(root[only])) return [root, "$"];
  return [root[only] as Json, `$.${escapeKey(only)}`];
}

// --- core recursion ---------------------------------------------------------

function emitTableFor(
  node: Json,
  path: string,
  parentPath: string | null,
  label: string,
  depth: number,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
  rangeNote?: string,
): void {
  const rows: Row[] = [];
  const cols = makeColumnBuilder();

  const parentIdKey: string | null =
    parentPath === null
      ? null
      : typeof parentRowId === "number"
        ? "_parent_idx"
        : "_parent_id";

  if (parentIdKey) {
    cols.ensure(
      parentIdKey,
      "synthetic",
      parentIdKey === "_parent_idx"
        ? "Row index of parent — no scalar id found"
        : undefined,
    );
  }

  if (isArray(node)) {
    // Heterogeneous split: contiguous runs of same kind become peer tables; this table covers the primary run only.
    const runs = contiguousRuns(node);
    if (runs.length > 1) {
      for (const run of runs) {
        const runNote = run.from === run.to ? `[${run.from}]` : `[${run.from}..${run.to}]`;
        const runPath = `${path}${runNote}`;
        const runLabel = labelFor(runPath) === "root" ? runNote : labelFor(runPath);
        emitTableFor(
          run.items.length > 0 && isArray(run.items[0])
            ? run.items                       // array-of-arrays → treat each as arr for its own recursion
            : run.items,
          runPath,
          path,
          runLabel,
          depth + 1,
          parentRowId,
          tables,
          runNote,
        );
      }
      // Primary table for the heterogeneous array is empty — we've split everything out.
      const finalised = cols.finalize();
      tables.push({
        path,
        parentPath,
        label,
        depth,
        rows,
        columns: finalised.columns,
        hiddenColumnCount: finalised.hiddenColumnCount,
        rangeNote,
      });
      return;
    }

    node.forEach((item, i) => {
      rowFor(item, `${path}[${i}]`, i, rows, cols, parentIdKey, parentRowId, tables, depth);
    });
  } else if (isObject(node)) {
    rowFor(node, path, 0, rows, cols, parentIdKey, parentRowId, tables, depth);
  }

  const finalised = cols.finalize();
  tables.push({
    path,
    parentPath,
    label,
    depth,
    rows,
    columns: finalised.columns,
    hiddenColumnCount: finalised.hiddenColumnCount,
    rangeNote,
  });
}

// --- row + flatten ----------------------------------------------------------

function rowFor(
  item: Json,
  itemPath: string,
  idx: number,
  rows: Row[],
  cols: ReturnType<typeof makeColumnBuilder>,
  parentIdKey: string | null,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
  depth: number,
): void {
  const row: Row = {};

  if (isArray(item)) {
    // Row-is-array → recurse, emit peer. In this row, a count-link placeholder + _idx anchor.
    const arrLabel = itemPath.slice(itemPath.lastIndexOf(".") + 1); // falls back to full path for $[i]
    const niceLabel = `[${idx}]`;
    emitTableFor(item, itemPath, itemPath.split(/\[|\./)[0] || "$", niceLabel, depth + 1, idx, tables);
    cols.ensure("_idx", "synthetic");
    cols.ensure(niceLabel, "count-link");
    row["_idx"] = { kind: "scalar", value: idx };
    row[niceLabel] = { kind: "count-link", count: item.length, targetTablePath: itemPath };
  } else if (isScalar(item)) {
    cols.ensure("value", "scalar");
    row["value"] = { kind: "scalar", value: item };
  } else {
    // Object row.
    flattenObject(item, "", row, cols, itemPath, tables, 0, depth, itemPath);
    // Pass-through wrapper guard: object with only count-link columns → synthesize _idx.
    const hasOnlyCountLinks =
      Object.keys(row).length > 0 &&
      Object.values(row).every((c) => (c as CellValue).kind === "count-link");
    if (hasOnlyCountLinks) {
      cols.ensure("_idx", "synthetic");
      row["_idx"] = { kind: "scalar", value: idx };
    }
  }

  if (parentIdKey) {
    row[parentIdKey] = { kind: "scalar", value: parentRowId };
  }

  rows.push(row);
}

function flattenObject(
  obj: { [k: string]: Json },
  prefix: string,
  row: Row,
  cols: ReturnType<typeof makeColumnBuilder>,
  parentPath: string,
  tables: DecomposedTable[],
  flattenDepth: number,
  treeDepth: number,
  thisRowPath: string,
): void {
  const parentRowId = parentScalarIdOf(obj);

  for (const [k, v] of Object.entries(obj)) {
    const safeKey = escapeKey(k);
    const col = prefix ? `${prefix}.${safeKey}` : safeKey;

    if (isScalar(v)) {
      cols.ensure(col, prefix ? "dotted" : "scalar");
      row[col] = { kind: "scalar", value: v };
    } else if (isObject(v)) {
      if (flattenDepth < 2) {
        flattenObject(v, col, row, cols, parentPath, tables, flattenDepth + 1, treeDepth, thisRowPath);
      } else {
        cols.ensure(col, "nested-chip");
        row[col] = {
          kind: "chip-object",
          keyCount: Object.keys(v).length,
          jumpPath: `${parentPath}.${col}`,
        };
      }
    } else if (isArray(v)) {
      if (isArrayOfObjects(v) || isArrayOfArrays(v)) {
        const childPath = `${thisRowPath}.${col}`;
        emitTableFor(v, childPath, thisRowPath, col, treeDepth + 1, parentRowId ?? row_idx_fallback(row), tables);
        cols.ensure(col, "count-link");
        row[col] = { kind: "count-link", count: v.length, targetTablePath: childPath };
      } else {
        cols.ensure(col, "nested-chip");
        row[col] = {
          kind: "chip-array",
          count: v.length,
          jumpPath: `${parentPath}.${col}`,
        };
      }
    }
  }
}

// When nested emission happens before we know parentRowId (deeply-nested flattenObject case),
// fall back to the row's _idx if one was already set; else 0.
function row_idx_fallback(row: Row): number {
  const idx = row["_idx"];
  if (idx && idx.kind === "scalar" && typeof idx.value === "number") return idx.value;
  return 0;
}

// --- heterogeneous-array run splitting --------------------------------------

interface Run {
  from: number;       // inclusive
  to: number;         // inclusive
  items: Json[];
}

function contiguousRuns(arr: Json[]): Run[] {
  if (arr.length === 0) return [{ from: 0, to: -1, items: [] }];
  const firstKind = itemKind(arr[0]);
  const allSame = arr.every((v) => itemKind(v) === firstKind);
  if (allSame) return [{ from: 0, to: arr.length - 1, items: arr }];

  const runs: Run[] = [];
  let start = 0;
  let currentKind = itemKind(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    const k = itemKind(arr[i]);
    if (k !== currentKind) {
      runs.push({ from: start, to: i - 1, items: arr.slice(start, i) });
      start = i;
      currentKind = k;
    }
  }
  runs.push({ from: start, to: arr.length - 1, items: arr.slice(start) });
  return runs;
}
```

- [ ] **Step 4: Run the full suite — expect all 22 tests to pass**

Run: `./bun.exe test web/docs/response/shape.test.ts`
Expected: 22 pass. If any fail, debug against the spec's Algorithm section — do not change the tests.

- [ ] **Step 5: Typecheck and full test suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: typecheck clean; full suite passes (all tests including earlier + new).

- [ ] **Step 6: Commit**

```bash
git add web/docs/response/shape.ts web/docs/response/shape.test.ts
git commit -m "$(cat <<'EOF'
feat(response): peer tables, _parent_id, wrapper collapse, heterogeneous splits, 5-deep nesting

Completes the decomposition contract: array-of-object fields become
peer tables with synthesised _parent_id / _parent_idx joins; { data: [...] }
wrapping collapses one level; pass-through rows get _idx; heterogeneous
arrays split by contiguous kind runs; wide column unions truncate with
hiddenColumnCount; keys with dots are bracket-escaped. 22 shape tests
passing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: JSON tokenizer for Raw-tab highlighting

Tiny zero-dependency JSON tokenizer. TDD'd. Produces a flat array of `{ text, kind }` spans that the Raw tab renders as `<span class="tk-key">...</span>` etc.

**Files:**
- Create: `web/docs/response/highlight.ts`
- Create: `web/docs/response/highlight.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/docs/response/highlight.test.ts
import { describe, expect, test } from "bun:test";
import { tokenize } from "./highlight.ts";

function kindsOf(s: string): string[] {
  return tokenize(s).map((t) => t.kind);
}

describe("highlight.tokenize", () => {
  test("scalar constants", () => {
    expect(kindsOf("true")).toEqual(["bool"]);
    expect(kindsOf("false")).toEqual(["bool"]);
    expect(kindsOf("null")).toEqual(["null"]);
    expect(kindsOf("42")).toEqual(["number"]);
    expect(kindsOf("-3.14")).toEqual(["number"]);
    expect(kindsOf("1e9")).toEqual(["number"]);
    expect(kindsOf('"hi"')).toEqual(["string"]);
  });

  test("object with key / string / number", () => {
    const tokens = tokenize('{"id":"abc","n":7}');
    // Expected shape: punct { , key "id", punct :, string "abc", punct ,, key "n", punct :, number 7, punct }
    expect(tokens.map((t) => t.kind)).toEqual([
      "punct", "key", "punct", "string", "punct", "key", "punct", "number", "punct",
    ]);
    // Text roundtrip (no data lost):
    expect(tokens.map((t) => t.text).join("")).toBe('{"id":"abc","n":7}');
  });

  test("whitespace is preserved as ws kind", () => {
    const tokens = tokenize('{\n  "x": 1\n}');
    expect(tokens.map((t) => t.text).join("")).toBe('{\n  "x": 1\n}');
    // Kind sequence ignoring ws:
    const nonWs = tokens.filter((t) => t.kind !== "ws").map((t) => t.kind);
    expect(nonWs).toEqual(["punct", "key", "punct", "number", "punct"]);
  });

  test("arrays and nested structures", () => {
    const tokens = tokenize('[{"a":null},[true]]');
    expect(tokens.map((t) => t.kind).join(",")).toBe(
      "punct,punct,key,punct,null,punct,punct,punct,bool,punct,punct",
    );
  });

  test("escaped strings are kept intact (not truncated at the inner quote)", () => {
    const tokens = tokenize('"a\\"b"');
    expect(tokens).toEqual([{ kind: "string", text: '"a\\"b"' }]);
  });

  test("invalid input: preserves input as raw tokens rather than throwing", () => {
    // Not a full parser — we want graceful degradation on bad JSON.
    const tokens = tokenize("garb age");
    expect(tokens.map((t) => t.text).join("")).toBe("garb age");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `./bun.exe test web/docs/response/highlight.test.ts`
Expected: FAIL on import (module missing).

- [ ] **Step 3: Write `highlight.ts`**

```ts
// web/docs/response/highlight.ts
//
// Minimal JSON tokenizer for syntax highlighting in the Raw tab.
// Not a validator — degrades gracefully on malformed input.
// Distinguishes "key" (string followed by a colon) from "string" (all other strings).

export type TokenKind = "punct" | "key" | "string" | "number" | "bool" | "null" | "ws" | "raw";

export interface Token {
  kind: TokenKind;
  text: string;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      out.push({ kind: "ws", text: src.slice(i, j) });
      i = j;
      continue;
    }

    if (c === "{" || c === "}" || c === "[" || c === "]" || c === "," || c === ":") {
      out.push({ kind: "punct", text: c });
      i++;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') { j++; break; }
        j++;
      }
      const text = src.slice(i, j);
      // Peek past whitespace to see if a colon follows → key.
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      const kind: TokenKind = src[k] === ":" ? "key" : "string";
      out.push({ kind, text });
      i = j;
      continue;
    }

    // Number: optional -, digits, optional fractional + exponent.
    const numMatch = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      out.push({ kind: "number", text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    if (src.startsWith("true", i) || src.startsWith("false", i)) {
      const len = src.startsWith("true", i) ? 4 : 5;
      out.push({ kind: "bool", text: src.slice(i, i + len) });
      i += len;
      continue;
    }

    if (src.startsWith("null", i)) {
      out.push({ kind: "null", text: "null" });
      i += 4;
      continue;
    }

    // Fallback: consume up to the next JSON-structural character or whitespace as raw.
    let j = i;
    while (j < src.length && !/[\s{}[\]:,"]/.test(src[j])) j++;
    if (j === i) j++; // ensure forward progress
    out.push({ kind: "raw", text: src.slice(i, j) });
    i = j;
  }

  return out;
}
```

- [ ] **Step 4: Run tests — expect all to pass**

Run: `./bun.exe test web/docs/response/highlight.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add web/docs/response/highlight.ts web/docs/response/highlight.test.ts
git commit -m "$(cat <<'EOF'
feat(response): minimal JSON tokenizer for Raw-tab highlighting

Zero-dependency tokenizer emits {punct, key, string, number, bool, null,
ws, raw} spans. Graceful on malformed JSON. Drives the Raw tab's colour
pass without pulling in a highlighting library.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ResponseEmpty placeholder

Tiny component shown before the first send.

**Files:**
- Create: `web/docs/response/ResponseEmpty.svelte`

- [ ] **Step 1: Write `ResponseEmpty.svelte`**

```svelte
<script lang="ts">
  // No props.
</script>

<section class="empty">
  <div class="label">Response</div>
  <p>Send a request to see the response here.</p>
  <p class="hint"><kbd>F5</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send · <kbd>Ctrl</kbd>+<kbd>\</kbd> to collapse this panel</p>
</section>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-dim);
    font-family: var(--font-mono);
    padding: var(--space-4);
    gap: var(--space-2);
    text-align: center;
  }
  .label {
    color: var(--fg-dim);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  p { margin: 0; font-size: 12px; }
  .hint { font-size: 11px; color: var(--fg-dim); }
  kbd {
    font: inherit;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 1px 6px;
    font-size: 10.5px;
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/ResponseEmpty.svelte
git commit -m "$(cat <<'EOF'
feat(response): ResponseEmpty placeholder for the no-send-yet state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: HeadersTab

Response + request headers with redact-chips for sensitive values.

**Files:**
- Create: `web/docs/response/tabs/HeadersTab.svelte`

- [ ] **Step 1: Write `HeadersTab.svelte`**

```svelte
<script lang="ts">
  type Props = {
    responseHeaders: Record<string, string>;
    requestHeaders: Record<string, string>;
  };
  let { responseHeaders, requestHeaders }: Props = $props();

  const REDACT_KEYS = new Set(["authorization", "cookie", "set-cookie"]);

  let reqOpen = $state(false);
  let revealed = $state<Set<string>>(new Set());

  function toggleReveal(key: string) {
    const next = new Set(revealed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    revealed = next;
  }

  function isRedacted(key: string): boolean {
    return REDACT_KEYS.has(key.toLowerCase());
  }

  function sortedEntries(h: Record<string, string>): [string, string][] {
    return Object.entries(h).sort(([a], [b]) => a.localeCompare(b));
  }

  function copySection(h: Record<string, string>) {
    const text = sortedEntries(h)
      .map(([k, v]) => `${k}: ${isRedacted(k) && !revealed.has("§" + k) ? "***" : v}`)
      .join("\n");
    navigator.clipboard?.writeText(text).catch(() => { /* best effort */ });
  }
</script>

<section class="hdr">
  <div class="section">
    <header>
      <span class="label">Response headers ({Object.keys(responseHeaders).length})</span>
      <button onclick={() => copySection(responseHeaders)} aria-label="Copy response headers">Copy</button>
    </header>
    <dl>
      {#each sortedEntries(responseHeaders) as [k, v]}
        <dt>{k}</dt>
        <dd>
          {#if isRedacted(k) && !revealed.has("r:" + k)}
            <button class="reveal" onclick={() => toggleReveal("r:" + k)}>[show]</button>
            <span class="redacted">***</span>
          {:else}
            <span>{v}</span>
            {#if isRedacted(k)}
              <button class="reveal" onclick={() => toggleReveal("r:" + k)}>[hide]</button>
            {/if}
          {/if}
        </dd>
      {/each}
    </dl>
  </div>

  <div class="section">
    <header>
      <button class="toggle" onclick={() => (reqOpen = !reqOpen)} aria-expanded={reqOpen}>
        {reqOpen ? "▾" : "▸"} Request headers ({Object.keys(requestHeaders).length})
      </button>
      {#if reqOpen}
        <button onclick={() => copySection(requestHeaders)} aria-label="Copy request headers">Copy</button>
      {/if}
    </header>
    {#if reqOpen}
      <dl>
        {#each sortedEntries(requestHeaders) as [k, v]}
          <dt>{k}</dt>
          <dd>
            {#if isRedacted(k) && !revealed.has("q:" + k)}
              <button class="reveal" onclick={() => toggleReveal("q:" + k)}>[show]</button>
              <span class="redacted">***</span>
            {:else}
              <span>{v}</span>
              {#if isRedacted(k)}
                <button class="reveal" onclick={() => toggleReveal("q:" + k)}>[hide]</button>
              {/if}
            {/if}
          </dd>
        {/each}
      </dl>
    {/if}
  </div>
</section>

<style>
  .hdr { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-4); overflow: auto; height: 100%; }
  .section header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .label {
    color: var(--fg-dim);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  button:hover { color: var(--accent); border-color: var(--accent); }
  button.toggle {
    border: none;
    padding: 0;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--space-3);
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  dt { color: var(--fg-dim); }
  dd { color: var(--fg); margin: 0; overflow-wrap: anywhere; }
  .redacted { color: var(--fg-dim); }
  button.reveal {
    border: none;
    padding: 0 6px 0 0;
    color: var(--fg-dim);
    font-size: 11px;
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/tabs/HeadersTab.svelte
git commit -m "$(cat <<'EOF'
feat(response): HeadersTab with redact-on-click for sensitive values

Response section always visible; request section collapsible. Redacts
Authorization / Cookie / Set-Cookie by default with a [show]/[hide]
toggle. Copy button per section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: TimingTab

Four phase bars + bytes summary.

**Files:**
- Create: `web/docs/response/tabs/TimingTab.svelte`

- [ ] **Step 1: Write `TimingTab.svelte`**

```svelte
<script lang="ts">
  import type { ResponseTimings, ResponseBytes } from "../types.ts";

  type Props = {
    timings: ResponseTimings;
    bytes: ResponseBytes;
  };
  let { timings, bytes }: Props = $props();

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  const maxMs = $derived(
    Math.max(timings.authMs, timings.requestMs, timings.responseMs, timings.totalMs, 1),
  );

  type Phase = { label: string; ms: number; kind: string };
  const phases = $derived<Phase[]>([
    { label: "Auth", ms: timings.authMs, kind: "auth" },
    { label: "Request", ms: timings.requestMs, kind: "request" },
    { label: "Response", ms: timings.responseMs, kind: "response" },
    { label: "Total", ms: timings.totalMs, kind: "total" },
  ]);
</script>

<section class="timing">
  <div class="bars">
    {#each phases as phase}
      <div class="row">
        <span class="name">{phase.label}</span>
        <div class="track">
          <div class="bar kind-{phase.kind}" style="width: {(phase.ms / maxMs) * 100}%"></div>
        </div>
        <span class="ms">{phase.ms} ms</span>
      </div>
    {/each}
  </div>
  <div class="bytes">
    req: {formatBytes(bytes.requestBytes)} · resp: {formatBytes(bytes.responseBytes)}
  </div>
</section>

<style>
  .timing {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .bars { display: flex; flex-direction: column; gap: var(--space-2); }
  .row {
    display: grid;
    grid-template-columns: 80px 1fr 70px;
    align-items: center;
    gap: var(--space-3);
  }
  .name { color: var(--fg-dim); }
  .track {
    height: 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 180ms ease;
  }
  .bar.kind-auth     { background: color-mix(in srgb, var(--accent) 70%, var(--fg-dim) 30%); }
  .bar.kind-request  { background: var(--accent); }
  .bar.kind-response { background: color-mix(in srgb, var(--accent) 85%, var(--fg) 15%); }
  .bar.kind-total    { background: var(--fg-dim); opacity: 0.6; }
  .ms { color: var(--fg); text-align: right; }
  .bytes { color: var(--fg-dim); font-size: 11px; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/tabs/TimingTab.svelte
git commit -m "$(cat <<'EOF'
feat(response): TimingTab with Auth / Request / Response / Total bars and bytes summary

Bars render from the ResponseTimings object populated via the proxy's
X-Proxy-* headers. Bytes formatted as B / KB / MB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: RawTab

Pretty-print, syntax highlight (via `highlight.ts`), copy, line-number toggle, head-slice for > 1 MB bodies.

**Files:**
- Create: `web/docs/response/tabs/RawTab.svelte`

- [ ] **Step 1: Write `RawTab.svelte`**

```svelte
<script lang="ts">
  import { tokenize } from "../highlight.ts";

  type Props = {
    bodyText: string;
    contentType: string | null;
  };
  let { bodyText, contentType }: Props = $props();

  const HEAD_SLICE_BYTES = 64 * 1024;
  const HEAD_THRESHOLD_BYTES = 1024 * 1024;

  let prettyOn = $state(true);
  let lineNumbersOn = $state(false);
  let showAll = $state(false);

  const isJson = $derived(!!contentType && contentType.startsWith("application/json"));
  const isTooBig = $derived(bodyText.length > HEAD_THRESHOLD_BYTES);

  // Cheap binary heuristic: any C0 control (except \t \n \r) or replacement char (U+FFFD)
  // in the first 512 chars means the server's text-decode mangled the bytes. Show hex head.
  function looksBinary(s: string): boolean {
    const head = s.slice(0, 512);
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0B\x0C\x0E-\x1F�]/.test(head);
  }
  const isBinary = $derived(!isJson && bodyText.length > 0 && looksBinary(bodyText));

  function hexHead(s: string, bytes: number): string {
    const out: string[] = [];
    const limit = Math.min(s.length, bytes);
    for (let i = 0; i < limit; i += 16) {
      const chunk = s.slice(i, Math.min(i + 16, limit));
      const hex = Array.from(chunk).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
      out.push(`${i.toString(16).padStart(6, "0")}  ${hex}`);
    }
    return out.join("\n");
  }

  const displayText = $derived.by(() => {
    if (isBinary && !showAll) {
      return `Binary — ${bodyText.length} bytes. First 512 bytes:\n\n${hexHead(bodyText, 512)}`;
    }
    const source = isTooBig && !showAll ? bodyText.slice(0, HEAD_SLICE_BYTES) : bodyText;
    if (!isJson || !prettyOn) return source;
    try {
      return JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      return source;
    }
  });

  const tokens = $derived(isJson ? tokenize(displayText) : null);

  const lines = $derived(displayText.split("\n"));

  function copy() {
    navigator.clipboard?.writeText(displayText).catch(() => { /* best effort */ });
  }
</script>

<section class="raw">
  <header>
    <label>
      <input type="checkbox" bind:checked={prettyOn} disabled={!isJson} /> Pretty
    </label>
    <label>
      <input type="checkbox" bind:checked={lineNumbersOn} /> Line numbers
    </label>
    <span class="spacer"></span>
    <span class="meta">
      {isBinary ? "binary" : isJson ? "application/json" : (contentType ?? "plaintext")} · {bodyText.length} B
      {#if (isTooBig || isBinary) && !showAll}
        <button onclick={() => (showAll = true)}>
          Show all{isTooBig ? ` (${(bodyText.length / (1024*1024)).toFixed(2)} MB)` : ""}
        </button>
      {/if}
    </span>
    <button onclick={copy} aria-label="Copy body">Copy</button>
  </header>

  {#if lineNumbersOn}
    <div class="body with-gutter">
      <pre class="gutter">{lines.map((_, i) => i + 1).join("\n")}</pre>
      <pre class="text">{#if tokens}{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}{:else}{displayText}{/if}</pre>
    </div>
  {:else}
    <pre class="body text">{#if tokens}{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}{:else}{displayText}{/if}</pre>
  {/if}
</section>

<style>
  .raw {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--fg-dim);
    font-size: 11px;
  }
  header label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  header .spacer { flex: 1; }
  header .meta { color: var(--fg-dim); }
  header button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 2px 8px;
    cursor: pointer;
  }
  header button:hover { color: var(--accent); border-color: var(--accent); }

  .body {
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    background: var(--bg);
    color: var(--fg);
    white-space: pre;
    flex: 1;
  }
  .with-gutter {
    display: grid;
    grid-template-columns: auto 1fr;
  }
  .gutter {
    color: var(--fg-dim);
    user-select: none;
    padding-right: var(--space-3);
    border-right: 1px solid var(--border);
    margin: 0;
    margin-right: var(--space-3);
  }
  .text { margin: 0; padding: 0; }

  /* Theme-aware token colours. */
  :global(.tk-key)    { color: var(--accent); }
  :global(.tk-string) { color: var(--fg); }
  :global(.tk-number) { color: color-mix(in srgb, var(--accent) 60%, var(--fg) 40%); }
  :global(.tk-bool)   { color: color-mix(in srgb, var(--accent) 50%, var(--fg) 50%); }
  :global(.tk-null)   { color: var(--fg-dim); }
  :global(.tk-punct)  { color: var(--fg-dim); }
  :global(.tk-raw)    { color: var(--fg); }
  :global(.tk-ws)     { white-space: pre; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/tabs/RawTab.svelte
git commit -m "$(cat <<'EOF'
feat(response): RawTab with syntax highlighting, pretty toggle, line numbers, head-slice

Highlights JSON via the in-tree tokenizer — no library dependency.
Bodies > 1 MB render a 64 KB head slice with a \"Show all\" expander
to prevent paint freeze.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: DataTable — one flat table with typed cell rendering

Renders a single `DecomposedTable`. Handles all four `CellValue` kinds, long-string truncation, virtualisation for tables with > 1000 rows.

**Files:**
- Create: `web/docs/response/DataTable.svelte`

- [ ] **Step 1: Write `DataTable.svelte`**

```svelte
<script lang="ts">
  import type { DecomposedTable, CellValue, Column } from "./types.ts";

  type Props = {
    table: DecomposedTable;
    /** Called when a count-link cell is clicked. */
    onNavigate?: (targetPath: string) => void;
    /** Called when a chip cell is clicked (jump to Raw). */
    onJumpToRaw?: (jumpPath: string) => void;
  };
  let { table, onNavigate, onJumpToRaw }: Props = $props();

  const STRING_TRUNCATE = 80;

  let expandedCells = $state<Set<string>>(new Set());

  function cellKey(rowIdx: number, colKey: string): string {
    return `${rowIdx}:${colKey}`;
  }

  function renderScalar(v: string | number | boolean | null): string {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }

  function truncatedScalar(text: string): { truncated: boolean; display: string } {
    if (text.length <= STRING_TRUNCATE) return { truncated: false, display: text };
    return { truncated: true, display: text.slice(0, STRING_TRUNCATE) + "…" };
  }

  function toggleExpand(key: string) {
    const next = new Set(expandedCells);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedCells = next;
  }

  const visibleRows = $derived.by(() => {
    // Simple ceiling for v1 — cap at 500 rows rendered, show a footer note for the rest.
    // Full virtualisation can come later if users hit the cap routinely.
    return table.rows.slice(0, 500);
  });

  const overflowCount = $derived(Math.max(0, table.rows.length - visibleRows.length));
</script>

<div class="dt">
  {#if table.columns.length === 0}
    <div class="empty">
      {table.rows.length === 0 ? "Empty — 0 rows, 0 columns" : `${table.rows.length} rows · 0 columns`}
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          {#each table.columns as col}
            <th title={col.synthNote ?? ""} class="kind-{col.kind}">{col.key}</th>
          {/each}
          {#if table.hiddenColumnCount}
            <th class="hidden-cols">+{table.hiddenColumnCount} more</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each visibleRows as row, rowIdx}
          <tr>
            {#each table.columns as col}
              {@const cell = row[col.key] as CellValue | undefined}
              <td>
                {#if cell === undefined}
                  <span class="dim">—</span>
                {:else if cell.kind === "scalar"}
                  {@const text = renderScalar(cell.value)}
                  {@const t = truncatedScalar(text)}
                  {#if cell.value === null}
                    <span class="dim">null</span>
                  {:else if t.truncated && !expandedCells.has(cellKey(rowIdx, col.key))}
                    <span title={text}>{t.display}</span>
                    <button class="more" onclick={() => toggleExpand(cellKey(rowIdx, col.key))}>+</button>
                  {:else if t.truncated}
                    <span>{text}</span>
                    <button class="more" onclick={() => toggleExpand(cellKey(rowIdx, col.key))}>−</button>
                  {:else}
                    <span>{text}</span>
                  {/if}
                {:else if cell.kind === "chip-array"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>[{cell.count}]</button>
                {:else if cell.kind === "chip-object"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>{`{${cell.keyCount}}`}</button>
                {:else if cell.kind === "count-link"}
                  <button class="chip" onclick={() => onNavigate?.(cell.targetTablePath)}>→ {cell.count} {cell.count === 1 ? "row" : "rows"}</button>
                {/if}
              </td>
            {/each}
            {#if table.hiddenColumnCount}
              <td class="hidden-cols dim">…</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if overflowCount > 0}
      <div class="overflow">+ {overflowCount} more rows (showing first 500)</div>
    {/if}
  {/if}
</div>

<style>
  .dt { overflow: auto; height: 100%; font-family: var(--font-mono); font-size: 11.5px; }
  table { border-collapse: collapse; width: 100%; }
  th, td {
    border-bottom: 1px solid var(--border);
    padding: 3px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--bg-panel);
    color: var(--fg-dim);
    font-weight: normal;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  th.kind-synthetic { font-style: italic; }
  th.hidden-cols { color: var(--fg-dim); }
  td { color: var(--fg); }
  td.hidden-cols { color: var(--fg-dim); }
  .dim { color: var(--fg-dim); }
  .chip {
    font: inherit;
    background: var(--bg-panel);
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 0 6px;
    cursor: pointer;
    font-size: 11px;
  }
  .chip:hover { color: var(--accent); border-color: var(--accent); }
  .more {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: 11px;
  }
  .more:hover { color: var(--accent); }
  .empty {
    color: var(--fg-dim);
    padding: var(--space-4);
    text-align: center;
    font-size: 12px;
  }
  .overflow {
    padding: var(--space-2) var(--space-3);
    color: var(--fg-dim);
    font-size: 11px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/DataTable.svelte
git commit -m "$(cat <<'EOF'
feat(response): DataTable renders one DecomposedTable with typed cell rendering

Handles scalar / chip-array / chip-object / count-link cells. Long
strings truncate at 80 chars with click-to-expand. Rows cap at 500 for
v1; overflow shown as a footer note.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: TableRail — tree of peer-table paths with chevrons and filter

**Files:**
- Create: `web/docs/response/TableRail.svelte`

- [ ] **Step 1: Write `TableRail.svelte`**

```svelte
<script lang="ts">
  import type { DecomposedTable } from "./types.ts";

  type Props = {
    tables: DecomposedTable[];
    activePath: string;
    onSelect: (path: string) => void;
  };
  let { tables, activePath, onSelect }: Props = $props();

  const MAX_RAIL = 50;
  const MAX_INDENT_DEPTH = 5;

  let filter = $state("");
  let collapsed = $state<Set<string>>(new Set());

  function toggleCollapse(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function hasChildren(path: string): boolean {
    return tables.some((t) => t.parentPath === path);
  }

  function isHiddenByCollapsedAncestor(table: DecomposedTable): boolean {
    let p = table.parentPath;
    while (p) {
      if (collapsed.has(p)) return true;
      const parent = tables.find((t) => t.path === p);
      p = parent ? parent.parentPath : null;
    }
    return false;
  }

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return tables.filter((t) => {
      if (isHiddenByCollapsedAncestor(t)) return false;
      if (!q) return true;
      return t.path.toLowerCase().includes(q) || t.label.toLowerCase().includes(q);
    });
  });

  const visible = $derived(filtered.slice(0, MAX_RAIL));
  const hiddenCount = $derived(filtered.length - visible.length);
</script>

<aside class="rail">
  {#if tables.length > MAX_RAIL}
    <div class="filter">
      <input
        type="text"
        placeholder="Filter paths…"
        bind:value={filter}
        aria-label="Filter tables"
      />
    </div>
  {/if}
  <div class="items">
    {#each visible as t}
      <div
        class="item depth-{Math.min(t.depth, MAX_INDENT_DEPTH)}"
        class:active={t.path === activePath}
        onclick={() => onSelect(t.path)}
        onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(t.path); }}
        role="button"
        tabindex="0"
      >
        {#if hasChildren(t.path)}
          <button
            class="caret"
            aria-label={collapsed.has(t.path) ? "expand" : "collapse"}
            onclick={(e) => { e.stopPropagation(); toggleCollapse(t.path); }}
          >{collapsed.has(t.path) ? "▸" : "▾"}</button>
        {:else}
          <span class="caret empty">·</span>
        {/if}
        <div class="body">
          <div class="label">{t.label}</div>
          <div class="meta">{t.rows.length}·{t.columns.length}</div>
          {#if t.depth >= MAX_INDENT_DEPTH}
            <div class="path">{t.path}</div>
          {/if}
        </div>
      </div>
    {/each}
    {#if hiddenCount > 0}
      <div class="overflow">… {hiddenCount} more — filter to find</div>
    {/if}
  </div>
</aside>

<style>
  .rail {
    min-width: 240px;
    max-width: 480px;
    width: 280px;
    resize: horizontal;
    overflow: auto;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    display: flex;
    flex-direction: column;
  }
  .filter {
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    position: sticky;
    top: 0;
  }
  .filter input {
    width: 100%;
    font: inherit;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 3px 6px;
  }
  .items { padding: 4px 0; }
  .item {
    display: flex;
    align-items: flex-start;
    padding: 3px 6px;
    cursor: pointer;
    border-left: 2px solid transparent;
    color: var(--fg-dim);
    gap: 4px;
  }
  .item:hover { background: var(--bg-raised); }
  .item.active {
    background: var(--bg);
    color: var(--fg);
    border-left-color: var(--accent);
  }
  .item.depth-0 { padding-left: 4px; }
  .item.depth-1 { padding-left: 20px; }
  .item.depth-2 { padding-left: 36px; }
  .item.depth-3 { padding-left: 52px; }
  .item.depth-4 { padding-left: 68px; }
  .item.depth-5 { padding-left: 84px; }
  .caret {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    padding: 0;
    width: 12px;
    flex-shrink: 0;
    cursor: pointer;
    text-align: center;
  }
  .caret.empty { cursor: default; }
  .body { flex: 1; min-width: 0; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--fg-dim); font-size: 10px; opacity: 0.8; }
  .path {
    color: var(--fg-dim);
    font-size: 10px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .overflow {
    color: var(--fg-dim);
    padding: 4px var(--space-3);
    font-size: 10.5px;
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/TableRail.svelte
git commit -m "$(cat <<'EOF'
feat(response): TableRail — tree navigation for peer tables

Tree with expand/collapse chevrons, horizontal resize, 50+ overflow
filter, indent capped at 5 levels. Label + row/col counts per item.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: TableTab — orchestrator (decomposition + rail + DataTable + breadcrumb)

**Files:**
- Create: `web/docs/response/tabs/TableTab.svelte`

- [ ] **Step 1: Write `TableTab.svelte`**

```svelte
<script lang="ts">
  import type { DecomposedTable, Json } from "../types.ts";
  import { decompose } from "../shape.ts";
  import DataTable from "../DataTable.svelte";
  import TableRail from "../TableRail.svelte";

  type Props = {
    /** The parsed JSON body. null if parsing failed or body wasn't JSON. */
    json: Json | null;
    contentType: string | null;
    bodyText: string;
    /** Called when a chip cell is clicked (lift to ResponsePanel → flip tab). */
    onJumpToRaw: (jumpPath: string) => void;
  };
  let { json, contentType, bodyText, onJumpToRaw }: Props = $props();

  const tables = $derived<DecomposedTable[]>(json === null ? [] : decompose(json));
  let selectedPath = $state<string>("");

  $effect(() => {
    // Whenever the table list changes, pick a sane default selection.
    if (tables.length === 0) return;
    if (!tables.find((t) => t.path === selectedPath)) {
      selectedPath = tables[0].path;
    }
  });

  const selectedTable = $derived<DecomposedTable | null>(
    tables.find((t) => t.path === selectedPath) ?? null,
  );

  const breadcrumbs = $derived.by(() => {
    if (!selectedTable) return [] as DecomposedTable[];
    const chain: DecomposedTable[] = [];
    let current: DecomposedTable | undefined = selectedTable;
    while (current) {
      chain.unshift(current);
      const parent: DecomposedTable | undefined = current.parentPath
        ? tables.find((t) => t.path === current!.parentPath)
        : undefined;
      current = parent;
    }
    return chain;
  });
</script>

<section class="table-tab">
  {#if json === null}
    <div class="not-tabular">
      <p>Not JSON — see <strong>Raw</strong>.</p>
      <p class="dim">Content-Type: <code>{contentType ?? "(none)"}</code> · {bodyText.length} B</p>
    </div>
  {:else if tables.length === 0}
    <div class="not-tabular">
      <p>Not tabular — see <strong>Raw</strong>.</p>
      <p class="dim">Root is a scalar value.</p>
    </div>
  {:else}
    <div class="layout" class:single={tables.length <= 1}>
      {#if tables.length > 1}
        <TableRail
          tables={tables}
          activePath={selectedPath}
          onSelect={(p) => (selectedPath = p)}
        />
      {/if}
      <div class="content">
        {#if selectedTable}
          <div class="crumbs">
            <span class="path-label">
              {#if breadcrumbs.length > 1}
                {#each breadcrumbs as crumb, i}
                  {#if i > 0}<span class="sep"> / </span>{/if}
                  {#if i < breadcrumbs.length - 1}
                    <a onclick={() => (selectedPath = crumb.path)} role="button" tabindex="0">{crumb.label}</a>
                  {:else}
                    <strong>{crumb.label}</strong>
                  {/if}
                {/each}
              {:else}
                <strong>{selectedTable.label}</strong>
              {/if}
            </span>
            <span class="meta">
              {selectedTable.rows.length} rows · {selectedTable.columns.length} cols
              {#if selectedTable.rangeNote}&nbsp;· heterogeneous run {selectedTable.rangeNote}{/if}
            </span>
          </div>
          <DataTable
            table={selectedTable}
            onNavigate={(p) => (selectedPath = p)}
            onJumpToRaw={onJumpToRaw}
          />
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .table-tab { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .layout { display: flex; flex: 1; min-height: 0; }
  .layout.single { display: block; }
  .content { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .crumbs {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px var(--space-3);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-dim);
  }
  .crumbs a {
    color: var(--fg-dim);
    border-bottom: 1px dashed var(--border);
    cursor: pointer;
  }
  .crumbs a:hover { color: var(--accent); }
  .crumbs strong { color: var(--fg); font-weight: normal; }
  .crumbs .sep { color: var(--fg-dim); padding: 0 4px; }
  .crumbs .meta { color: var(--fg-dim); }
  .not-tabular {
    padding: var(--space-5);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .not-tabular p { margin: var(--space-2) 0; }
  .dim { color: var(--fg-dim); font-size: 11px; }
  code { font-family: var(--font-mono); }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/tabs/TableTab.svelte
git commit -m "$(cat <<'EOF'
feat(response): TableTab orchestrates decomposition + rail + DataTable + breadcrumb

Single-table responses render without the rail. Multi-table responses
get the tree rail + content pane with breadcrumbs. Chip clicks jump to
Raw via an onJumpToRaw callback lifted to ResponsePanel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: ResponsePanel shell — status row, tab strip, tab routing

Glues all tabs together. Handles tab selection + jump-to-Raw from TableTab. Parses JSON once at entry.

**Files:**
- Create: `web/docs/response/ResponsePanel.svelte`

- [ ] **Step 1: Write `ResponsePanel.svelte`**

```svelte
<script lang="ts">
  import type { Json, ResponseView } from "./types.ts";
  import TableTab from "./tabs/TableTab.svelte";
  import RawTab from "./tabs/RawTab.svelte";
  import HeadersTab from "./tabs/HeadersTab.svelte";
  import TimingTab from "./tabs/TimingTab.svelte";

  type Props = ResponseView & {
    sending: boolean;
    onclear?: () => void;
  };
  let {
    status, statusText, headers, requestHeaders, bodyText, contentType,
    timings, bytes, proxyError, sending, onclear,
  }: Props = $props();

  type Tab = "table" | "raw" | "headers" | "timing";
  let activeTab = $state<Tab>("table");

  const parsedJson = $derived.by<Json | null>(() => {
    if (!contentType?.startsWith("application/json")) return null;
    try { return JSON.parse(bodyText) as Json; } catch { return null; }
  });

  // When the body changes and the previously-active tab no longer makes sense, fall back to Raw.
  $effect(() => {
    if (activeTab === "table" && parsedJson === null && contentType !== null) {
      activeTab = "raw";
    }
  });

  const statusClass = $derived.by(() => {
    if (status === 0) return "err";
    if (status >= 200 && status < 300) return "ok";
    if (status >= 300 && status < 400) return "redir";
    if (status >= 400 && status < 500) return "warn";
    return "err";
  });

  const errorBanner = $derived.by(() => {
    if (!proxyError) return null;
    switch (proxyError.error) {
      case "no-active-environment": return "No environment is active. Pick one in the top bar.";
      case "no-api-key":             return "The active environment has no API key set. Edit it in Settings → Environments.";
      case "auth-failed":            return `Couldn't exchange the API key for a JWT: ${proxyError.detail ?? "(no detail)"}`;
      case "upstream-unreachable":   return `Couldn't reach Ethos: ${proxyError.detail ?? "(no detail)"}`;
      default: return null;
    }
  });

  function jumpToRaw(_jumpPath: string) {
    // v1: flip to Raw. Scrolling to the exact path is a nice-to-have follow-up.
    activeTab = "raw";
  }
</script>

<section class="panel">
  <header>
    <span class="status status-{statusClass}">{status} {statusText}</span>
    <span class="duration">· {timings.totalMs} ms</span>
    {#if sending}<span class="sending">· sending…</span>{/if}
    {#if errorBanner}<span class="banner">{errorBanner}</span>{/if}
    <span class="spacer"></span>
    <nav class="tabs" role="tablist">
      <button role="tab" aria-selected={activeTab === "table"}  onclick={() => (activeTab = "table")}>Table</button>
      <button role="tab" aria-selected={activeTab === "raw"}    onclick={() => (activeTab = "raw")}>Raw</button>
      <button role="tab" aria-selected={activeTab === "headers"} onclick={() => (activeTab = "headers")}>Headers</button>
      <button role="tab" aria-selected={activeTab === "timing"} onclick={() => (activeTab = "timing")}>Timing</button>
    </nav>
    {#if onclear}
      <button class="clear" onclick={onclear} aria-label="Clear response">×</button>
    {/if}
  </header>

  <div class="body">
    {#if activeTab === "table"}
      <TableTab json={parsedJson} contentType={contentType} bodyText={bodyText} onJumpToRaw={jumpToRaw} />
    {:else if activeTab === "raw"}
      <RawTab bodyText={bodyText} contentType={contentType} />
    {:else if activeTab === "headers"}
      <HeadersTab responseHeaders={headers} requestHeaders={requestHeaders} />
    {:else}
      <TimingTab timings={timings} bytes={bytes} />
    {/if}
  </div>
</section>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 4px var(--space-3);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-dim);
  }
  .status { font-weight: bold; }
  .status-ok    { color: var(--accent); }
  .status-redir { color: var(--fg-dim); }
  .status-warn  { color: color-mix(in srgb, var(--accent) 60%, #d4a548 40%); }
  .status-err   { color: #ff8a8a; }
  .duration, .sending { color: var(--fg-dim); }
  .banner {
    background: #2a1818;
    color: #ffb0b0;
    border: 1px solid #bf5050;
    padding: 1px 8px;
    font-size: 11px;
  }
  .spacer { flex: 1; }
  .tabs { display: flex; }
  .tabs button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tabs button:hover { color: var(--accent); }
  .tabs button[aria-selected="true"] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .clear {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: 0 8px;
    font-size: 16px;
  }
  .clear:hover { color: var(--accent); }
  .body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .body > :global(*) { flex: 1; min-height: 0; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/docs/response/ResponsePanel.svelte
git commit -m "$(cat <<'EOF'
feat(response): ResponsePanel shell with status row, tab strip, and tab routing

Parses JSON once at entry; falls back to Raw when the body isn't JSON.
Proxy-error banner; onclear callback for the × button. Chip-jump from
TableTab flips the active tab to Raw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: TryPanel — remove inline stub, accept onSend/onAbort, wire AbortController + timings parsing

**Files:**
- Modify: `web/docs/TryPanel.svelte`

- [ ] **Step 1: Add the import + augment the Props type + remove the local response state**

Three edits in `web/docs/TryPanel.svelte`, top-to-bottom:

**1a.** At the top of the `<script>` block, near the other `import type` lines, add:

```ts
import type { ResponseView } from "./response/types.ts";
```

**1b.** Locate the existing `type Props = {` declaration (it lists `family`, `resource`, `version`, `focused`, `activeEnv`, `region`). Add these two fields **inside the existing type — do not create a second `type Props`**:

```ts
  onSend: (view: ResponseView) => void;
  onAbort: () => void;
```

**1c.** Delete the `let response = $state<{ … } | null>(null);` block entirely (the five-line declaration around lines 131–135 in the current file). Leave `let sending = $state(false);` in place — it's still used for the TryPanel's own Send-button UI, and App mirrors its own `isSending` independently.

- [ ] **Step 2: Replace `performSend` to use AbortController and hand the result to `onSend`**

Replace the existing `async function performSend()` body with:

```ts
let inflightCtl: AbortController | null = null;

async function performSend() {
  if (!focused || !currentSchema) return;

  // Cancel-previous: aborting any in-flight send. App mirrors the UI state through onSend/onAbort.
  if (inflightCtl) {
    inflightCtl.abort();
    onAbort();
  }
  const ctl = new AbortController();
  inflightCtl = ctl;

  sending = true;
  const t0 = performance.now();
  try {
    const headers = new Headers();
    const hasCustomAccept = state.headersOverridden["Accept"] === true;
    if (!hasCustomAccept) headers.set("Accept", autoAccept);
    for (const h of state.headers) {
      if (h.name && h.value) headers.set(h.name, h.value);
    }
    let body: BodyInit | undefined;
    if (focused.method !== "GET" && focused.method !== "HEAD" && focused.method !== "DELETE") {
      body = state.body.text;
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }
    const res = await fetch(
      `/api/ethos${computedUrl.startsWith("/") ? computedUrl : "/" + computedUrl}`,
      { method: focused.method, headers, body, signal: ctl.signal },
    );
    const bodyText = await res.text();
    const ct = res.headers.get("content-type");

    let proxyError: ResponseView["proxyError"] | undefined;
    if (!res.ok && ct?.startsWith("application/json")) {
      try {
        const parsed = JSON.parse(bodyText) as { error?: string; detail?: string; envId?: string };
        if (parsed && typeof parsed.error === "string") {
          proxyError = { error: parsed.error, detail: parsed.detail, envId: parsed.envId };
        }
      } catch { /* not our structured error */ }
    }

    const headersObj: Record<string, string> = {};
    res.headers.forEach((v, k) => { headersObj[k.toLowerCase()] = v; });

    const authMs = Number(res.headers.get("x-proxy-auth-ms") ?? 0);
    const requestMs = Number(res.headers.get("x-proxy-request-ms") ?? 0);
    const responseMs = Number(res.headers.get("x-proxy-response-ms") ?? 0);
    const reqBytes = Number(res.headers.get("x-proxy-request-bytes") ?? 0);
    const respBytes = Number(res.headers.get("x-proxy-response-bytes") ?? bodyText.length);

    const requestHeadersObj: Record<string, string> = {};
    headers.forEach((v, k) => { requestHeadersObj[k.toLowerCase()] = v; });

    const view: ResponseView = {
      status: res.status,
      statusText: res.statusText,
      headers: headersObj,
      requestHeaders: requestHeadersObj,
      bodyText,
      contentType: ct,
      timings: {
        authMs: Number.isFinite(authMs) ? authMs : 0,
        requestMs: Number.isFinite(requestMs) ? requestMs : 0,
        responseMs: Number.isFinite(responseMs) ? responseMs : 0,
        totalMs: Math.round(performance.now() - t0),
      },
      bytes: {
        requestBytes: Number.isFinite(reqBytes) ? reqBytes : 0,
        responseBytes: Number.isFinite(respBytes) ? respBytes : 0,
      },
      proxyError,
    };
    onSend(view);
  } catch (e) {
    // Aborted by a subsequent send: do nothing (App will have received onAbort above, and the new send will call onSend).
    if ((e as { name?: string }).name === "AbortError") return;
    onSend({
      status: 0,
      statusText: "Network error",
      headers: {},
      requestHeaders: {},
      bodyText: String((e as Error).message),
      contentType: null,
      timings: { authMs: 0, requestMs: 0, responseMs: 0, totalMs: Math.round(performance.now() - t0) },
      bytes: { requestBytes: 0, responseBytes: 0 },
    });
  } finally {
    if (inflightCtl === ctl) inflightCtl = null;
    sending = false;
  }
}
```

- [ ] **Step 3: Remove the `ResponseStub` render block**

In the `.svelte` template section, delete the entire block (around lines 346-356 in the current file):

```svelte
{#if response}
  <ResponseStub
    status={response.status}
    statusText={response.statusText}
    durationMs={response.durationMs}
    headers={response.headers}
    bodyText={response.bodyText}
    contentType={response.contentType}
    proxyError={response.proxyError}
  />
{/if}
```

Also delete the import at the top:
```ts
import ResponseStub from "./try/ResponseStub.svelte";
```

- [ ] **Step 4: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean. If there are errors about missing `onSend`/`onAbort` callers, that's expected — Task 16 wires App.svelte to pass them.

- [ ] **Step 5: Do NOT commit yet**

This task is paired with Task 16. Committing TryPanel without the App wiring would leave `main` broken. Proceed to Task 16 and commit both together.

---

## Task 16: App.svelte — lift state, wire callbacks, render ResponsePanel

**Files:**
- Modify: `web/App.svelte`

- [ ] **Step 1: Import and add state**

Add the import near the other component imports at the top of the `<script>`:

```ts
import ResponsePanel from "./docs/response/ResponsePanel.svelte";
import ResponseEmpty from "./docs/response/ResponseEmpty.svelte";
import type { ResponseView } from "./docs/response/types.ts";
```

Near the other `$state` declarations (e.g. next to `focusedEndpoint`), add:

```ts
let currentResponse = $state<ResponseView | null>(null);
let isSending = $state(false);
```

- [ ] **Step 2: Pass callbacks to TryPanel**

Find the `<TryPanel ... />` block inside the `right()` snippet (around line 698). Add three props:

```svelte
<TryPanel
  family={route.family}
  resource={route.resource}
  version={route.version ?? ""}
  focused={focusedEndpoint}
  activeEnv={activeEnv}
  region={config?.region ?? "us"}
  onSend={(view) => { currentResponse = view; isSending = false; }}
  onAbort={() => { isSending = false; /* previous view stays visible until the new one lands */ }}
/>
```

**Note:** if TryPanel's Props type reports `onSendingChange` as required, add a fourth: `onSendingChange={(b) => (isSending = b)}`. Whether to expose it is a judgement call — in Task 15 the `sending` flag is kept local; omit the prop unless typecheck demands it.

- [ ] **Step 3: Replace the `response()` snippet**

Find (around line 714-720):

```svelte
{#snippet response()}
  <PanePlaceholder
    title="Response"
    description="Raw · table · headers · timing tabs. Appears here after you send a request. Ctrl+\\ to collapse."
    taskNumber={15}
  />
{/snippet}
```

Replace with:

```svelte
{#snippet response()}
  {#if currentResponse}
    <ResponsePanel
      {...currentResponse}
      sending={isSending}
      onclear={() => (currentResponse = null)}
    />
  {:else}
    <ResponseEmpty />
  {/if}
{/snippet}
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 5: Commit (bundled with Task 15)**

```bash
git add web/App.svelte web/docs/TryPanel.svelte
git commit -m "$(cat <<'EOF'
feat(response): lift response state to App; render ResponsePanel in bottom slot

TryPanel no longer renders the inline ResponseStub. It uses an
AbortController for cancel-previous concurrency and hands the
ResponseView (now including phase timings + bytes from the proxy's
X-Proxy-* headers) to App via an onSend callback. App owns
currentResponse + isSending and renders <ResponsePanel> in the Shell's
response snippet, or <ResponseEmpty> before the first send.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Delete ResponseStub + final smoke

**Files:**
- Delete: `web/docs/try/ResponseStub.svelte`

- [ ] **Step 1: Confirm there are no remaining references**

Run: `./bun.exe x rg "ResponseStub" web server tests 2>/dev/null || true`
Expected: no matches. If any appear, fix them before proceeding.

- [ ] **Step 2: Delete the file**

```bash
git rm web/docs/try/ResponseStub.svelte
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 4: Build the web bundle — catches any import-time issues Vite might flag**

Run: `./bun.exe run build:web`
Expected: exit 0. Warnings about pre-existing unused CSS are OK; a new `ERROR` is not.

- [ ] **Step 5: Manual smoke against a running app**

Start both servers via `npm run dev` (which runs both concurrently):
- backend at http://localhost:5757
- frontend at http://localhost:5173

Open http://localhost:5173 in a browser. Check each:

1. **No send yet** — Response slot shows "Send a request to see the response here." with the F5 / Ctrl+Enter hint.
2. **Happy GET** — open an endpoint, press F5. Response lands in the bottom slot. Table tab is active. Shape is sensible. Raw tab pretty-prints. Headers tab shows both sections. Timing tab shows four bars + bytes.
3. **Multi-table response** — find an endpoint that returns nested arrays (e.g. a `/persons` response with `credentials[]` and `names[]`). Verify the rail appears with tree indents + row/col counts. Click a rail item to switch tables. Click a `→ N rows` chip in DataTable to navigate to that peer. Click a chip-object or chip-array to jump to Raw.
4. **Cancel-previous** — press F5 twice quickly against a long-running endpoint. Only the second response appears; no spurious "Network error" from the first.
5. **Proxy error** — switch to an env with no API key and send. Red banner appears in the status row; the tabs still render the 400 JSON body.
6. **Ctrl+\\** — toggles the response panel.
7. **Theme swap** — cycle through phosphor → amber → dos → beige. Colours should remain legible in every tab.

If any step fails, fix before committing. If everything passes, proceed.

- [ ] **Step 6: Update PLAN.md**

Open `PLAN.md`, find the `## Phase 2 — in progress` section, and update item 6's line from:

```
6. **Response panel UI** (`web/docs/ResponsePanel.svelte`) — full-width under the three top panes (mockup locked in Phase 0). Tabs: **raw** (syntax-highlighted JSON) / **table** (array → SQL-style grid; big deal for PL/SQL vets) / **headers** / **timing**.
```

to:

```
6. ✅ **Response panel UI** (`web/docs/response/ResponsePanel.svelte`) — full-width under the three top panes. Raw (syntax-highlighted JSON with pretty-print + line-numbers + head-slice) / Table (algorithmic decomposition into flat peer tables with a tree rail for nested shapes, typed chip cells for nested / array values) / Headers (response + request sections, redact chips on Authorization / Cookie) / Timing (Auth / Request / Response / Total phase bars + bytes). Response state lifted from TryPanel to App.svelte with AbortController for cancel-previous. Proxy extended with `X-Proxy-*` response headers for phase timings + bytes. ResponseStub deleted.
```

Also update the "**Shipped so far**" paragraph at the top of `## Phase 2 — in progress` to say "items 1-6 + 7" instead of "items 1-5 + 7", and adjust test count to reflect the new shape + highlight + proxy tests.

- [ ] **Step 7: Final commit**

```bash
git add web/docs/try/ResponseStub.svelte PLAN.md
git commit -m "$(cat <<'EOF'
feat(response): drop ResponseStub; ship Phase 2 item 6

ResponseStub is strictly superseded by ResponsePanel. PLAN.md updated
to mark item 6 shipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification checklist

Run once at the end:

- [ ] `./bun.exe run typecheck` — clean.
- [ ] `./bun.exe test` — all pass. Expected new tests: ~2 for auth timings, ~1 for proxy headers, 22 for shape, 6 for highlight. Total ~150 tests across ~13 files.
- [ ] `./bun.exe run build:web` — exit 0.
- [ ] Manual smoke (steps 5.1–5.7 from Task 17) — all pass.
- [ ] `git log --oneline` shows one commit per task (15 feature commits: tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15+16 bundled, 17) plus the spec commit.

---

## Self-review notes (inline fixes + known deltas from spec)

Caught during plan self-review:

- **Task 15 step 1** originally had a synthetic `type Props = /* ... existing props ... */ & {...}` block (a placeholder forbidden by the writing-plans rules). Replaced with three explicit in-place edits (import, augment existing type, delete `response` state).
- **Task 15 step 2** originally assumed `performSend` could discard the `AbortError` silently via a generic `catch`. Fixed: explicit `name === "AbortError"` branch at the top of the catch so network errors still reach `onSend`.
- **Task 16 step 2** clarified the optional `onSendingChange` prop so the reader does not have to search TryPanel.
- **Task 1 step 1** the initial draft updated the tests in place without telling the implementer that older tests still read a bare string. Fixed: added an explicit "Note for the implementer" instructing them to update every existing `const jwt = await tokenCache.getJwt(envId)` usage.
- **Task 5 tests** — the heterogeneous-array test originally asserted primary path `$` with scalar columns; the algorithm's correct behaviour is to split ALL kinds, leaving the primary `$` empty of data rows. Updated the assertion to match.
- **Task 14** — the `jumpToRaw(_jumpPath)` function receives the path but only flips the tab; scrolling to the exact path in Raw is noted as follow-up. Matches the spec's "click → Raw tab scrolled to jumpPath" with the degraded-but-usable v1 behaviour of "flip to Raw, user finds the key".
- **Task 10** adds a small binary heuristic + 512-byte hex head, honouring the spec's binary-body clause. A > 1 MB binary body still shows just the hex head until the user clicks Show all (which then falls through to the raw text path — intentionally rough; binary responses from Ethos are ~never seen in practice).

Known deltas from spec (accepted):

- **Row virtualisation**: the spec calls for "visible window + 30-row overscan" on tables > 1000 rows. The plan ships a simpler "cap at 500 rows + overflow footer" in Task 11. Real Ellucian responses are usually small; if users routinely hit the cap we promote to proper virtualisation as a follow-up ticket.
- **Jump-to-Raw scroll-to-path**: the spec's chips say "click → Raw scrolled to jumpPath". The plan ships "click → flip to Raw" in Task 14 without the scroll hop. Scrolling is a nice-to-have; the initial behaviour lets users find the key with Ctrl+F in the pretty-printed body.
- **Happy-dom Svelte component tests**: the spec mentioned them as one option. The plan explicitly defers them (stated in the Testing policy paragraph) in favour of pure-TS tests + manual smoke. Matches the repo's existing testing pattern.
