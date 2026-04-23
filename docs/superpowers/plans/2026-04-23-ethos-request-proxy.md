# Ethos Request Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transparent HTTP proxy at `/api/ethos/<path>` that forwards UI requests to the user's Ellucian Ethos tenant with a cached Bearer JWT attached, retries once on 401, and emits a `ProxyCompleteEvent` hook for later request-history wiring (item 8). Remove env-level `defaultHeaders` in favour of per-request headers on the Try panel (item 5).

**Architecture:** Single factory `createEthosProxy(opts): RouteHandler` in `server/proxy/ethos.ts` — pure over the env store, token cache, region base-URL getter, and an optional `onComplete` hook. A tiny module-level `handleEthosProxy` wrapper in the same file lazy-constructs a singleton at first request for production wiring, matching the pattern used by every other `server/routes/*.ts` handler. Tests mirror the ethos-auth style: in-process `Bun.serve` fixture as the fake upstream.

**Tech Stack:** Bun 1.1+, TypeScript, `bun:test`, Svelte 5 (for the `EnvironmentsPanel` cleanup).

**Spec:** `docs/superpowers/specs/2026-04-23-ethos-request-proxy-design.md`.

---

## File structure

**Create:**
- `server/proxy/ethos.ts` — factory (`createEthosProxy`) + lazy-singleton handler (`handleEthosProxy`).
- `tests/ethos-proxy.test.ts` — proxy integration tests against a Bun fixture upstream.

**Modify:**
- `server/environments/store.ts` — remove `defaultHeaders` from `Environment` / input types; strip legacy field on load.
- `server/routes/environments.ts` — stop reading `defaultHeaders` from incoming POST/PATCH bodies.
- `server/routes/index.ts` — register `handleEthosProxy` in the dispatcher.
- `web/settings/EnvironmentsPanel.svelte` — drop the default-headers UI block + related form state.
- `tests/environments.test.ts` — drop `defaultHeaders` from fixtures (compile error today after the type change).
- `tests/ethos-auth.test.ts` — same (it seeds envs via `envStore.add(...)`).

---

## Task 1: Remove `defaultHeaders` from the environment store

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`
- Modify: `tests/ethos-auth.test.ts`

- [ ] **Step 1: Add failing test for load-time strip of legacy `defaultHeaders`**

In `tests/environments.test.ts`, add this test near the bottom of the `describe` block (right before the closing `})`) — assert that an `environments.json` pre-written with the legacy field round-trips clean:

```ts
  test("legacy defaultHeaders field on disk is stripped on load", () => {
    writeFileSync(
      envPath,
      JSON.stringify(
        {
          envs: [
            {
              id: "legacy-id",
              name: "legacy",
              production: false,
              defaultHeaders: { Accept: "application/json" },
            },
          ],
          activeId: null,
        },
        null,
        2,
      ),
      "utf8",
    );
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const { envs } = store.list();
    expect(envs).toHaveLength(1);
    expect(envs[0]).not.toHaveProperty("defaultHeaders");
  });
```

- [ ] **Step 2: Run the test to verify it fails (and observe the compile error noise)**

```bash
./bun.exe test tests/environments.test.ts
```

Expected: `environments.test.ts` still passes the legacy case because the loader doesn't currently strip the field. But `not.toHaveProperty("defaultHeaders")` will FAIL because the env object still carries it on its in-memory representation.

- [ ] **Step 3: Remove `defaultHeaders` from `Environment` + inputs and strip on load**

Edit `server/environments/store.ts`:

Replace the three interfaces:

```ts
export interface Environment {
  id: string;
  name: string;
  production: boolean;
}

export interface EnvironmentWithStatus extends Environment {
  hasApiKey: boolean;
}

export interface CreateEnvironmentInput {
  name: string;
  production: boolean;
  apiKey: string;
}

export interface UpdateEnvironmentInput {
  name?: string;
  production?: boolean;
  apiKey?: string;
}
```

Inside the `load()` function, replace the line that assigns `cache` with a version that strips `defaultHeaders` (and any other future legacy fields) off each env:

```ts
    // Strip legacy fields we no longer carry. `defaultHeaders` moved to the
    // Try panel in Phase 2 item 4; old environments.json files still have it.
    const sanitized: Environment[] = p.envs.map((raw) => {
      const e = raw as Environment & { defaultHeaders?: unknown };
      return { id: e.id, name: e.name, production: e.production };
    });
    cache = { envs: sanitized, activeId };
    return cache;
```

In `add(...)`, remove the `defaultHeaders` property when constructing the env:

```ts
      const env: Environment = {
        id: crypto.randomUUID(),
        name,
        production: input.production,
      };
```

In `update(...)`, remove the `if (input.defaultHeaders !== undefined) env.defaultHeaders = input.defaultHeaders;` line.

- [ ] **Step 4: Delete `defaultHeaders: ...` from every env fixture in the two test files**

In `tests/environments.test.ts`: search for `defaultHeaders:` and remove that property from every object literal passed to `store.add(...)` or `store.update(...)`. There are ~15 occurrences.

In `tests/ethos-auth.test.ts`: same — `defaultHeaders: {}` appears 7 times in `envStore.add(...)` calls.

- [ ] **Step 5: Run the env-store and ethos-auth tests**

```bash
./bun.exe test tests/environments.test.ts tests/ethos-auth.test.ts
```

Expected: all pass, including the new `legacy defaultHeaders field on disk is stripped on load` test.

- [ ] **Step 6: Commit**

```bash
git add server/environments/store.ts tests/environments.test.ts tests/ethos-auth.test.ts
git commit -m "$(cat <<'EOF'
refactor: drop defaultHeaders from environment profile

Per-request headers move to the Try panel (Phase 2 item 4 design).
The loader strips the legacy field on read so existing environments.json
files round-trip cleanly on next write. No user-visible migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Stop accepting `defaultHeaders` on the env HTTP routes

**Files:**
- Modify: `server/routes/environments.ts`

- [ ] **Step 1: Remove `defaultHeaders` from the POST handler**

Edit `server/routes/environments.ts`. Replace the `getStore().add({...})` call in the POST branch (currently lines ~45-51) with:

```ts
      const created = getStore().add({
        name: String(body.name ?? ""),
        production: Boolean(body.production),
        apiKey: String(body.apiKey ?? ""),
      });
```

(Drops the `defaultHeaders: body.defaultHeaders && typeof body.defaultHeaders === "object" ? body.defaultHeaders : {},` line.)

The PATCH handler already passes `body` through verbatim — since `UpdateEnvironmentInput` no longer has `defaultHeaders`, TS will complain if the field is present. Confirm by running typecheck:

- [ ] **Step 2: Run typecheck to confirm no stragglers**

```bash
./bun.exe run typecheck
```

Expected: clean pass. If any other file still references `defaultHeaders` on an `Environment` or input, fix it.

- [ ] **Step 3: Run the full test suite**

```bash
./bun.exe test
```

Expected: still 86/0 (or whatever we had before, minus any tests we added in Task 1). No regressions from the route-handler change.

- [ ] **Step 4: Commit**

```bash
git add server/routes/environments.ts
git commit -m "$(cat <<'EOF'
refactor: stop accepting defaultHeaders on env POST/PATCH

Field is ignored on ingress now that per-request headers belong to the
Try panel. Matches the store-side removal in the previous commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove the default-headers UI from `EnvironmentsPanel.svelte`

**Files:**
- Modify: `web/settings/EnvironmentsPanel.svelte`

- [ ] **Step 1: Update the `Environment` type at the top**

Edit `web/settings/EnvironmentsPanel.svelte`. Replace the `type Environment = { ... }` block near the top of the `<script>` with:

```ts
  type Environment = {
    id: string;
    name: string;
    production: boolean;
    hasApiKey: boolean;
  };
```

(Drops the `defaultHeaders: Record<string, string>;` line.)

- [ ] **Step 2: Remove the `fHeaders` state + helpers**

Delete these lines from the `<script>` block:

```ts
  // Default headers as an array of [key, value] pairs for the editor.
  let fHeaders = $state<Array<{ k: string; v: string }>>([]);
```

Delete the three helper functions `addHeader`, `removeHeader`, `headersFromForm`.

In `startAdd()` remove the `fHeaders = [ ... Accept/Content-Type prefills ... ]` assignment.
In `startEdit()` remove the `fHeaders = Object.entries(env.defaultHeaders).map(...)` line.

In `save()`, remove `defaultHeaders: headersFromForm(),` from both the POST body and the PATCH body objects.

- [ ] **Step 3: Remove the headers-editor block from the `{#snippet form()}` template**

Delete the entire `<div class="headers-editor"> ... </div>` block (currently lines 288-298).

- [ ] **Step 4: Remove the now-unused CSS rules**

In the `<style>` block, delete the `.headers-editor`, `.headers-label`, and `.header-row`, `.header-row input`, `.header-row button` rules (currently lines ~435-439).

- [ ] **Step 5: Manual browser verification**

Both dev servers should already be running. Open http://localhost:5173/#/settings/environments (or wherever the Environments panel lives — navigate via the gear icon / Settings tab in the top bar). Verify:

1. Existing envs still render.
2. Clicking "+ Add environment" shows a form with Name, Production checkbox, API key. **No** headers editor.
3. Clicking "Edit" on an existing env shows the same fields. **No** headers editor.
4. Saving a new env succeeds; the env appears in the list.
5. The API key `[SHOW]`/`[HIDE]` reveal toggle still works on edit.

If any TypeScript error surfaces in the browser console or the Vite terminal, resolve it — usually a missed reference to `fHeaders` or `defaultHeaders`.

- [ ] **Step 6: Commit**

```bash
git add web/settings/EnvironmentsPanel.svelte
git commit -m "$(cat <<'EOF'
refactor(web): drop headers editor from Environments panel

Content negotiation (Accept / Content-Type / version pinning) moves to
the per-request Try panel. The Environments panel is now just name,
production flag, and API key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Proxy skeleton — happy GET + URL extraction

**Files:**
- Create: `server/proxy/ethos.ts`
- Create: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Write the fixture helper + first failing test**

Create `tests/ethos-proxy.test.ts` with the imports, fixture, `beforeEach/afterEach`, and the first test:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSecretStore } from "../server/auth/secrets.ts";
import { createEnvironmentStore, type EnvironmentStore } from "../server/environments/store.ts";
import { createTokenCache, type TokenCache } from "../server/auth/ethos.ts";
import { createEthosProxy, type ProxyCompleteEvent } from "../server/proxy/ethos.ts";

const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig-placeholder";

/** Records every incoming request so tests can assert on what upstream saw. */
interface RecordedRequest {
  method: string;
  path: string;           // includes query string
  headers: Record<string, string>;
  body: Uint8Array;       // empty Uint8Array when no body
}

type UpstreamBehavior =
  | { kind: "echo" }                                                             // default — 200 JSON { method, path, headers, bodyB64 }
  | { kind: "static"; status: number; headers?: Record<string, string>; body: string }
  | { kind: "auth-sequence"; first401: boolean };                                // first request 401, subsequent 200

function startUpstream(apiKey: string) {
  const received: RecordedRequest[] = [];
  let behavior: UpstreamBehavior = { kind: "echo" };
  let authSeqCallCount = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      // /auth is the token-cache endpoint; separate handler.
      if (url.pathname === "/auth" && req.method === "POST") {
        const auth = req.headers.get("Authorization");
        if (auth === `Bearer ${apiKey}`) {
          return new Response(SAMPLE_JWT, { status: 200, headers: { "content-type": "text/plain" } });
        }
        return new Response("unauthorized", { status: 401 });
      }

      // Everything else is recorded as an upstream proxy hit.
      const bodyBytes = new Uint8Array(await req.arrayBuffer());
      received.push({
        method: req.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries([...req.headers.entries()]),
        body: bodyBytes,
      });

      if (behavior.kind === "echo") {
        return Response.json({
          method: req.method,
          path: url.pathname + url.search,
          bodyLength: bodyBytes.length,
        });
      }
      if (behavior.kind === "static") {
        return new Response(behavior.body, {
          status: behavior.status,
          headers: behavior.headers ?? { "content-type": "text/plain" },
        });
      }
      if (behavior.kind === "auth-sequence") {
        authSeqCallCount++;
        if (authSeqCallCount === 1 && behavior.first401) {
          return new Response("stale token", { status: 401 });
        }
        return Response.json({ ok: true, callCount: authSeqCallCount });
      }
      return new Response("unexpected", { status: 500 });
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    received,
    set(b: UpstreamBehavior) { behavior = b; authSeqCallCount = 0; },
    stop() { server.stop(true); },
  };
}

describe("ethos request proxy", () => {
  let dir: string;
  let envPath: string;
  let secretPath: string;
  let upstream: ReturnType<typeof startUpstream>;
  let envStore: EnvironmentStore;
  let tokenCache: TokenCache;
  let envId: string;

  const API_KEY = "test-api-key-abc";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acx-proxy-test-"));
    envPath = join(dir, "environments.json");
    secretPath = join(dir, "secrets.json");
    upstream = startUpstream(API_KEY);

    const secrets = createSecretStore(secretPath);
    envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({ name: "test", production: false, apiKey: API_KEY });
    envStore.setActive(env.id);
    envId = env.id;
    tokenCache = createTokenCache(envStore, secrets, () => upstream.baseUrl);
  });

  afterEach(() => {
    upstream.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // Helper: build a Request into the proxy and a URL for it.
  function proxyReq(method: string, suffix: string, init: RequestInit = {}): [Request, URL] {
    const url = new URL(`http://localhost:0/api/ethos${suffix}`);
    const req = new Request(url, { method, ...init });
    return [req, url];
  }

  test("happy GET — forwards path + query, injects Bearer, returns upstream response", async () => {
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });

    const [req, url] = proxyReq("GET", "/persons?limit=10");
    const res = await handler(req, url);

    expect(res).toBeDefined();
    expect(res!.status).toBe(200);

    const body = (await res!.json()) as { method: string; path: string };
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/persons?limit=10");

    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0]!.headers.authorization).toBe(`Bearer ${SAMPLE_JWT}`);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the proxy module doesn't exist**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: FAIL with a module resolution error (`Cannot find module "../server/proxy/ethos.ts"`).

- [ ] **Step 3: Create the minimal proxy module**

Create `server/proxy/ethos.ts`:

```ts
import type { EnvironmentStore } from "../environments/store.ts";
import type { TokenCache } from "../auth/ethos.ts";
import type { RouteHandler } from "../routes/types.ts";

export interface ProxyCompleteEvent {
  envId: string;
  method: string;
  path: string;
  upstreamUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: Uint8Array | null;
  status: number;
  upstreamStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: Uint8Array;
  durationMs: number;
  retried: boolean;
}

export interface EthosProxyOptions {
  envStore: EnvironmentStore;
  tokenCache: TokenCache;
  baseUrlGetter: () => string;
  onComplete?: (event: ProxyCompleteEvent) => void | Promise<void>;
}

const PREFIX = "/api/ethos";

export function createEthosProxy(opts: EthosProxyOptions): RouteHandler {
  return async (req, url) => {
    if (!url.pathname.startsWith(PREFIX + "/") && url.pathname !== PREFIX) return undefined;
    const suffix = url.pathname.slice(PREFIX.length); // "/<rest>" or "" if pathname === PREFIX
    const path = (suffix || "/") + url.search;

    const { activeId } = opts.envStore.list();
    if (!activeId) {
      return Response.json({ error: "no-active-environment" }, { status: 400 });
    }

    const jwt = await opts.tokenCache.getJwt(activeId);
    const upstreamUrl = `${opts.baseUrlGetter()}${path}`;

    const outgoingHeaders = new Headers();
    outgoingHeaders.set("Authorization", `Bearer ${jwt}`);

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: outgoingHeaders,
    });
    const body = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: the `happy GET` test passes.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — happy-path GET forwarding

Skeleton createEthosProxy factory: matches /api/ethos/* with URL prefix
strip, looks up active env, injects Bearer from the token cache, forwards
method/path/query, returns upstream response. Header merging, body
passthrough, 401 retry, error mapping, and the onComplete hook come next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Method + body passthrough

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Write the failing POST-with-body test**

Add inside the same `describe` block in `tests/ethos-proxy.test.ts`:

```ts
  test("happy POST — body bytes arrive verbatim", async () => {
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });

    const payload = { firstName: "James", lastName: "Abbot" };
    const [req, url] = proxyReq("POST", "/persons", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await handler(req, url);
    expect(res!.status).toBe(200);

    expect(upstream.received).toHaveLength(1);
    const got = upstream.received[0]!;
    expect(got.method).toBe("POST");
    expect(got.path).toBe("/persons");
    expect(new TextDecoder().decode(got.body)).toBe(JSON.stringify(payload));
    // Content-Type should have been forwarded (no merge rules yet — plain passthrough).
    expect(got.headers["content-type"]).toBe("application/json");
  });
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: FAIL — upstream receives an empty body because the proxy isn't forwarding it yet.

- [ ] **Step 3: Update the proxy to forward body + headers (pre-merge — we'll refine in Task 6)**

In `server/proxy/ethos.ts`, replace the handler body with:

```ts
  return async (req, url) => {
    if (!url.pathname.startsWith(PREFIX + "/") && url.pathname !== PREFIX) return undefined;
    const suffix = url.pathname.slice(PREFIX.length);
    const path = (suffix || "/") + url.search;

    const { activeId } = opts.envStore.list();
    if (!activeId) {
      return Response.json({ error: "no-active-environment" }, { status: 400 });
    }

    const jwt = await opts.tokenCache.getJwt(activeId);
    const upstreamUrl = `${opts.baseUrlGetter()}${path}`;

    // Buffer the body once — this Uint8Array is used both for the outgoing
    // request and (later) for the onComplete hook.
    const incomingBody = req.body ? new Uint8Array(await req.arrayBuffer()) : null;

    const outgoingHeaders = new Headers(req.headers);
    outgoingHeaders.set("Authorization", `Bearer ${jwt}`);

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: incomingBody ?? undefined,
    });
    const body = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  };
```

- [ ] **Step 4: Run the tests**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: both the happy GET and happy POST tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — method + body passthrough

Buffer incoming body to a Uint8Array (once) and forward verbatim. Client-
sent Content-Type flows through for now; strip/merge rules land next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Header merge + strip rules

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Write the three failing header-handling tests**

Add to `tests/ethos-proxy.test.ts`:

```ts
  test("client Accept header passes through to upstream", async () => {
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/persons", {
      headers: { Accept: "application/vnd.hedtech.integration.v16+json" },
    });
    await handler(req, url);

    expect(upstream.received[0]!.headers.accept).toBe("application/vnd.hedtech.integration.v16+json");
  });

  test("incoming Authorization header is dropped; only cache's Bearer reaches upstream", async () => {
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/persons", {
      headers: { Authorization: "Bearer rogue-token-from-client" },
    });
    await handler(req, url);

    expect(upstream.received[0]!.headers.authorization).toBe(`Bearer ${SAMPLE_JWT}`);
  });

  test("hop-by-hop and browser-added headers are stripped before forwarding", async () => {
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/persons", {
      headers: {
        Origin: "http://localhost:5173",
        Referer: "http://localhost:5173/try",
        "Sec-Fetch-Site": "same-origin",
        Cookie: "session=abc",
      },
    });
    await handler(req, url);

    const got = upstream.received[0]!.headers;
    expect(got.origin).toBeUndefined();
    expect(got.referer).toBeUndefined();
    expect(got["sec-fetch-site"]).toBeUndefined();
    expect(got.cookie).toBeUndefined();
  });
```

- [ ] **Step 2: Run, verify failures**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: the Accept test PASSES (Bun's `new Headers(req.headers)` carries everything through), but the Authorization-strip and hop-by-hop-strip tests FAIL because the current code doesn't filter incoming headers.

- [ ] **Step 3: Add the strip-list to the proxy**

In `server/proxy/ethos.ts`, add this constant below the existing `PREFIX` const and replace the `outgoingHeaders` block:

```ts
// Headers to drop from the incoming request before forwarding to Ethos:
//   hop-by-hop (fetch recomputes),
//   browser-injected identity signals (not relevant cross-origin anyway),
//   any client-supplied Authorization (we inject our own JWT),
//   cookies (different origin, never useful upstream).
const DROP_EXACT = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "origin",
  "referer",
  "authorization",
  "cookie",
]);
const DROP_PREFIX = ["sec-fetch-", "proxy-"];

function filterIncomingHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DROP_EXACT.has(lower)) return;
    if (DROP_PREFIX.some((p) => lower.startsWith(p))) return;
    out.set(name, value);
  });
  return out;
}
```

Replace the `const outgoingHeaders = new Headers(req.headers);` line with:

```ts
    const outgoingHeaders = filterIncomingHeaders(req.headers);
    outgoingHeaders.set("Authorization", `Bearer ${jwt}`);
```

- [ ] **Step 4: Run, verify all pass**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: all header tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — header strip-list + Bearer injection order

Drop hop-by-hop headers, any client Authorization, cookies, Sec-Fetch-*,
Proxy-*. Our injected Bearer is set last so it can't be overridden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Response header shaping — strip encoding + add sidecar

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Write failing response-header tests**

Add to `tests/ethos-proxy.test.ts`:

```ts
  test("upstream Transfer-Encoding / Content-Encoding are not forwarded to client", async () => {
    upstream.set({
      kind: "static",
      status: 200,
      headers: { "content-type": "text/plain", "content-encoding": "gzip", "transfer-encoding": "chunked" },
      body: "hello",
    });
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/anything");
    const res = await handler(req, url);

    expect(res!.headers.get("content-encoding")).toBeNull();
    expect(res!.headers.get("transfer-encoding")).toBeNull();
    expect(res!.headers.get("content-type")).toBe("text/plain");
  });

  test("X-Proxy-Upstream-Status sidecar header reflects the upstream status", async () => {
    upstream.set({ kind: "static", status: 418, body: "tea" });
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/anything");
    const res = await handler(req, url);

    expect(res!.status).toBe(418);
    expect(res!.headers.get("x-proxy-upstream-status")).toBe("418");
  });
```

- [ ] **Step 2: Run, verify failures**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: both new tests FAIL — current code passes upstream headers through unfiltered and adds no sidecar.

- [ ] **Step 3: Add response shaping**

In `server/proxy/ethos.ts`, add this constant below `DROP_PREFIX`:

```ts
// Response-side headers to strip. Bun's fetch has already decoded the body,
// so advertising the upstream encoding would mislead the client.
const RESPONSE_DROP = new Set(["content-encoding", "transfer-encoding"]);

function shapeResponseHeaders(src: Headers, upstreamStatus: number): Headers {
  const out = new Headers();
  src.forEach((value, name) => {
    if (RESPONSE_DROP.has(name.toLowerCase())) return;
    out.set(name, value);
  });
  out.set("X-Proxy-Upstream-Status", String(upstreamStatus));
  return out;
}
```

Replace the final `return new Response(body, {...})` line with:

```ts
    return new Response(body, {
      status: upstreamRes.status,
      headers: shapeResponseHeaders(upstreamRes.headers, upstreamRes.status),
    });
```

- [ ] **Step 4: Run, verify all pass**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — response header shaping + upstream-status sidecar

Strip Transfer-Encoding/Content-Encoding (already decoded by Bun's fetch)
and add X-Proxy-Upstream-Status so the Response panel can show the pre-
retry status truthfully.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 401 retry

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Add a retry-aware record on the upstream fixture**

At the top of `tests/ethos-proxy.test.ts`, extend `UpstreamBehavior` to include a two-call sequence. Replace the `auth-sequence` variant's handling in `startUpstream` — it's already wired. Confirm you can call:

```ts
upstream.set({ kind: "auth-sequence", first401: true });
```

(Should already work from Task 4 step 1; if not, re-read that step's `auth-sequence` branch.)

- [ ] **Step 2: Add failing retry tests**

Add to `tests/ethos-proxy.test.ts`:

```ts
  test("401 on first call triggers token invalidate + single retry with fresh JWT", async () => {
    upstream.set({ kind: "auth-sequence", first401: true });
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(200);
    expect(res!.headers.get("x-proxy-upstream-status")).toBe("401");
    // Two upstream calls (the 401 + the retry). Plus at least one /auth call.
    expect(upstream.received).toHaveLength(2);
  });

  test("401 on retry too — surfaces second 401 to client, no third attempt", async () => {
    upstream.set({
      kind: "static",
      status: 401,
      headers: { "content-type": "text/plain" },
      body: "still unauthorized",
    });
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });
    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(401);
    expect(upstream.received).toHaveLength(2);
  });
```

- [ ] **Step 3: Run, verify failures**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: both retry tests FAIL — single-attempt code returns 401 and doesn't replay.

- [ ] **Step 4: Implement the retry**

In `server/proxy/ethos.ts`, replace the single-fetch block (everything from `const upstreamRes = await fetch(...)` to the final `return new Response(...)`) with a helper + retry flow. Replace the entire `return async (req, url) => { ... }` body:

```ts
  return async (req, url) => {
    if (!url.pathname.startsWith(PREFIX + "/") && url.pathname !== PREFIX) return undefined;
    const suffix = url.pathname.slice(PREFIX.length);
    const path = (suffix || "/") + url.search;

    const { activeId } = opts.envStore.list();
    if (!activeId) {
      return Response.json({ error: "no-active-environment" }, { status: 400 });
    }

    const incomingBody = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
    const upstreamUrl = `${opts.baseUrlGetter()}${path}`;
    const baseHeaders = filterIncomingHeaders(req.headers);

    async function attempt(): Promise<Response> {
      const jwt = await opts.tokenCache.getJwt(activeId!);
      const hdrs = new Headers(baseHeaders);
      hdrs.set("Authorization", `Bearer ${jwt}`);
      return fetch(upstreamUrl, {
        method: req.method,
        headers: hdrs,
        body: incomingBody ?? undefined,
      });
    }

    const firstRes = await attempt();
    let upstreamRes = firstRes;
    const upstreamStatus = firstRes.status;

    if (firstRes.status === 401) {
      // Drain the body so Bun can reuse the socket cleanly.
      await firstRes.arrayBuffer().catch(() => undefined);
      opts.tokenCache.invalidate(activeId);
      upstreamRes = await attempt();
    }

    const responseBytes = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(responseBytes, {
      status: upstreamRes.status,
      headers: shapeResponseHeaders(upstreamRes.headers, upstreamStatus),
    });
  };
```

- [ ] **Step 5: Run, verify all pass**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: green — both retry cases work, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — one-shot 401 retry

On upstream 401: invalidate the token cache, re-fetch JWT, replay the
exact same request once. Second-401 surfaces to the client. The sidecar
X-Proxy-Upstream-Status preserves the pre-retry status for debugging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Error mapping (400 + 502 cases)

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Add failing error-mapping tests**

Add to `tests/ethos-proxy.test.ts`:

```ts
  test("no active env → 400 no-active-environment", async () => {
    // Blank out active env so the proxy rejects.
    const secrets = createSecretStore(secretPath);
    const freshEnvStore = createEnvironmentStore(envPath + ".empty", secrets);
    const freshTokenCache = createTokenCache(freshEnvStore, secrets, () => upstream.baseUrl);
    const handler = createEthosProxy({
      envStore: freshEnvStore,
      tokenCache: freshTokenCache,
      baseUrlGetter: () => upstream.baseUrl,
    });

    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe("no-active-environment");
  });

  test("active env has no API key → 400 no-api-key", async () => {
    // Manually nuke the api key secret for the env set up in beforeEach.
    const secrets = createSecretStore(secretPath);
    secrets.deleteSecret(`env/${envId}/api_key`);
    const handler = createEthosProxy({ envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl });

    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string; envId: string };
    expect(body.error).toBe("no-api-key");
    expect(body.envId).toBe(envId);
  });

  test("auth fetch failure → 502 auth-failed", async () => {
    // Point baseUrl at a port nothing is listening on to force fetch rejection.
    const brokenCache = createTokenCache(
      envStore,
      createSecretStore(secretPath),
      () => "http://127.0.0.1:1", // reserved/unused
    );
    const handler = createEthosProxy({
      envStore,
      tokenCache: brokenCache,
      baseUrlGetter: () => upstream.baseUrl,
    });

    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { error: string; detail?: string };
    expect(body.error).toBe("auth-failed");
    expect(typeof body.detail).toBe("string");
  });

  test("upstream unreachable (fetch rejects) → 502 upstream-unreachable", async () => {
    // Stop the upstream after the token cache is primed, then make a request.
    await tokenCache.getJwt(envId); // primes the cache while upstream is alive
    upstream.stop();

    const handler = createEthosProxy({
      envStore,
      tokenCache,
      baseUrlGetter: () => upstream.baseUrl, // now points at a closed port
    });

    const [req, url] = proxyReq("GET", "/persons");
    const res = await handler(req, url);

    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { error: string; detail?: string };
    expect(body.error).toBe("upstream-unreachable");
  });
```

- [ ] **Step 2: Run, verify new tests fail in expected ways**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: the no-active-env test already passes (we added that handling in Task 4). The no-api-key / auth-failed / upstream-unreachable tests FAIL because the handler doesn't have those branches yet.

- [ ] **Step 3: Add the error branches**

In `server/proxy/ethos.ts`, inside the returned handler: replace the `const { activeId } = ...` block through the first `return` of the happy path with:

```ts
    const listed = opts.envStore.list();
    if (!listed.activeId) {
      return Response.json({ error: "no-active-environment" }, { status: 400 });
    }
    const activeId = listed.activeId;

    const env = opts.envStore.get(activeId);
    if (!env || !env.hasApiKey) {
      return Response.json({ error: "no-api-key", envId: activeId }, { status: 400 });
    }
```

Wrap the `attempt()` calls (or the body-buffering + attempt flow) in a `try { ... } catch { ... }` that classifies the thrown error:

```ts
    const incomingBody = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
    const upstreamUrl = `${opts.baseUrlGetter()}${path}`;
    const baseHeaders = filterIncomingHeaders(req.headers);

    async function attempt(): Promise<Response> {
      const jwt = await opts.tokenCache.getJwt(activeId);
      const hdrs = new Headers(baseHeaders);
      hdrs.set("Authorization", `Bearer ${jwt}`);
      return fetch(upstreamUrl, {
        method: req.method,
        headers: hdrs,
        body: incomingBody ?? undefined,
      });
    }

    let firstRes: Response;
    try {
      firstRes = await attempt();
    } catch (err) {
      return classifyFetchError(err);
    }
    let upstreamRes = firstRes;
    const upstreamStatus = firstRes.status;

    if (firstRes.status === 401) {
      await firstRes.arrayBuffer().catch(() => undefined);
      opts.tokenCache.invalidate(activeId);
      try {
        upstreamRes = await attempt();
      } catch (err) {
        return classifyFetchError(err);
      }
    }

    const responseBytes = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(responseBytes, {
      status: upstreamRes.status,
      headers: shapeResponseHeaders(upstreamRes.headers, upstreamStatus),
    });
```

Add this helper above `createEthosProxy` (or inside it, before the returned handler):

```ts
function classifyFetchError(err: unknown): Response {
  const detail = err instanceof Error ? err.message : String(err);
  // Heuristic: the token cache wraps its own fetch failures with "auth fetch failed"
  // or "auth request failed"; anything else is an upstream fetch rejection.
  if (/auth (fetch|request) failed|auth response/i.test(detail)) {
    return Response.json({ error: "auth-failed", detail }, { status: 502 });
  }
  return Response.json({ error: "upstream-unreachable", detail }, { status: 502 });
}
```

- [ ] **Step 4: Run, verify all pass**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — error mapping (400/502 paths)

400: no-active-environment / no-api-key (before we even try the upstream).
502: auth-failed (tokenCache.getJwt throws) / upstream-unreachable
(fetch rejects). All error bodies are JSON so the Response panel can
render them consistently alongside real Ethos responses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: onComplete hook — event shape, fire-and-forget, rejection safety

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `tests/ethos-proxy.test.ts`

- [ ] **Step 1: Write the hook tests**

Add to `tests/ethos-proxy.test.ts`:

```ts
  test("onComplete fires with the full event shape, Authorization redacted", async () => {
    const events: ProxyCompleteEvent[] = [];
    const handler = createEthosProxy({
      envStore,
      tokenCache,
      baseUrlGetter: () => upstream.baseUrl,
      onComplete: (e) => { events.push(e); },
    });

    const payload = { q: "x" };
    const [req, url] = proxyReq("POST", "/persons?limit=5", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await handler(req, url);

    // Hook is fire-and-forget sync in this test (synchronous callback), so it
    // has already fired by the time await handler resolves.
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.envId).toBe(envId);
    expect(e.method).toBe("POST");
    expect(e.path).toBe("/persons?limit=5");
    expect(e.upstreamUrl).toBe(`${upstream.baseUrl}/persons?limit=5`);
    expect(e.requestHeaders.authorization).toBe("Bearer ***");
    expect(new TextDecoder().decode(e.requestBody!)).toBe(JSON.stringify(payload));
    expect(e.status).toBe(200);
    expect(e.upstreamStatus).toBe(200);
    expect(e.retried).toBe(false);
    expect(typeof e.responseHeaders["content-type"]).toBe("string");
    expect(e.responseBody.byteLength).toBeGreaterThan(0);
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("onComplete retried=true and upstreamStatus=401 when a 401 retry fired", async () => {
    upstream.set({ kind: "auth-sequence", first401: true });
    const events: ProxyCompleteEvent[] = [];
    const handler = createEthosProxy({
      envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl,
      onComplete: (e) => { events.push(e); },
    });
    const [req, url] = proxyReq("GET", "/persons");
    await handler(req, url);

    expect(events).toHaveLength(1);
    expect(events[0]!.retried).toBe(true);
    expect(events[0]!.upstreamStatus).toBe(401);
    expect(events[0]!.status).toBe(200);
  });

  test("async onComplete does not block the client response", async () => {
    let hookDoneAt = 0;
    const handler = createEthosProxy({
      envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl,
      onComplete: async () => {
        await new Promise((r) => setTimeout(r, 100));
        hookDoneAt = performance.now();
      },
    });
    const [req, url] = proxyReq("GET", "/persons");
    const t0 = performance.now();
    await handler(req, url);
    const clientGotAt = performance.now();

    // Client response arrived well before the hook's 100ms sleep finished.
    expect(clientGotAt - t0).toBeLessThan(80);
    // Hook hasn't flipped the flag yet.
    expect(hookDoneAt).toBe(0);
  });

  test("rejecting onComplete does not crash subsequent calls", async () => {
    const handler = createEthosProxy({
      envStore, tokenCache, baseUrlGetter: () => upstream.baseUrl,
      onComplete: async () => { throw new Error("boom"); },
    });

    const [req1, url1] = proxyReq("GET", "/first");
    const res1 = await handler(req1, url1);
    expect(res1!.status).toBe(200);

    // Second call must also succeed.
    const [req2, url2] = proxyReq("GET", "/second");
    const res2 = await handler(req2, url2);
    expect(res2!.status).toBe(200);
  });
```

- [ ] **Step 2: Run, confirm failures**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: all four new tests FAIL — no hook wiring yet.

- [ ] **Step 3: Implement the hook**

In `server/proxy/ethos.ts`, add this helper above `createEthosProxy`:

```ts
function headersToObject(h: Headers, redactAuth: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = redactAuth && k.toLowerCase() === "authorization" ? "Bearer ***" : v;
  });
  return out;
}
```

Inside the returned handler, rework the happy-path return so it builds an event, fires the hook fire-and-forget, then returns. Full replacement of the handler body (from after the early-return guards to the end):

```ts
    const incomingBody = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
    const upstreamUrl = `${opts.baseUrlGetter()}${path}`;
    const baseHeaders = filterIncomingHeaders(req.headers);
    const startedAt = performance.now();

    async function attempt(): Promise<{ res: Response; outgoing: Headers }> {
      const jwt = await opts.tokenCache.getJwt(activeId);
      const hdrs = new Headers(baseHeaders);
      hdrs.set("Authorization", `Bearer ${jwt}`);
      const res = await fetch(upstreamUrl, {
        method: req.method,
        headers: hdrs,
        body: incomingBody ?? undefined,
      });
      return { res, outgoing: hdrs };
    }

    let first: { res: Response; outgoing: Headers };
    try {
      first = await attempt();
    } catch (err) {
      return classifyFetchError(err);
    }
    let finalAttempt = first;
    let retried = false;
    const upstreamStatus = first.res.status;

    if (first.res.status === 401) {
      await first.res.arrayBuffer().catch(() => undefined);
      opts.tokenCache.invalidate(activeId);
      try {
        finalAttempt = await attempt();
        retried = true;
      } catch (err) {
        return classifyFetchError(err);
      }
    }

    const responseBytes = new Uint8Array(await finalAttempt.res.arrayBuffer());
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

    return new Response(responseBytes, {
      status: finalAttempt.res.status,
      headers: shapeResponseHeaders(finalAttempt.res.headers, upstreamStatus),
    });
```

- [ ] **Step 4: Run, verify all pass**

```bash
./bun.exe test tests/ethos-proxy.test.ts
```

Expected: all fifteen-ish proxy tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts tests/ethos-proxy.test.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — onComplete hook with fire-and-forget safety

Per-request ProxyCompleteEvent: envId, method, path, upstreamUrl,
redacted request headers, request/response bodies, status + upstream
status, response headers, durationMs, retried flag. Hook is called
fire-and-forget before the response is returned; sync throws and
rejected promises are swallowed so a buggy logger can't crash the
proxy. Item 8 will plug in a SQLite request_history writer here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire into dispatcher + smoke test + full-suite regression

**Files:**
- Modify: `server/proxy/ethos.ts`
- Modify: `server/routes/index.ts`

- [ ] **Step 1: Add the lazy-singleton wrapper at the bottom of `server/proxy/ethos.ts`**

At the top of `server/proxy/ethos.ts`, add to the imports:

```ts
import { createEnvironmentStore } from "../environments/store.ts";
import { createSecretStore } from "../auth/secrets.ts";
import { createTokenCache } from "../auth/ethos.ts";
import { SECRETS_PATH, ENVIRONMENTS_PATH } from "../config.ts";
import { regionToBaseUrl } from "../environments/region.ts";
import { loadConfig } from "../config-store.ts";
```

At the very bottom of the file (after `createEthosProxy`), add:

```ts
// Module-level mutable URL ref — the token cache and the proxy both read
// it via closures. Updating this on each request lets a region change via
// Settings take effect without restarting the server OR blowing away cached
// JWTs (which we would if we rebuilt the token cache each call).
let currentBaseUrl = "";
let ethosSingleton: RouteHandler | undefined;

export const handleEthosProxy: RouteHandler = async (req, url) => {
  // loadConfig is a few-ms file read; negligible next to the outbound fetch.
  const config = await loadConfig();
  currentBaseUrl = regionToBaseUrl(config.region);

  if (!ethosSingleton) {
    const secrets = createSecretStore(SECRETS_PATH);
    const envStore = createEnvironmentStore(ENVIRONMENTS_PATH, secrets);
    const tokenCache = createTokenCache(envStore, secrets, () => currentBaseUrl);
    ethosSingleton = createEthosProxy({
      envStore,
      tokenCache,
      baseUrlGetter: () => currentBaseUrl,
      onComplete: undefined, // wired in Phase 2 item 8 (request history)
    });
  }
  return ethosSingleton(req, url);
};
```

- [ ] **Step 2: Register the handler in the dispatcher**

Edit `server/routes/index.ts`. Add an import:

```ts
import { handleEthosProxy } from "../proxy/ethos.ts";
```

Insert `handleEthosProxy` into the `apiHandlers` array, before `handleLineage` (order doesn't matter — routes are non-overlapping, but grouping it near the other auth-adjacent handlers is sensible):

```ts
const apiHandlers: RouteHandler[] = [
  handleStatus,
  handleConfig,
  handleEnvironments,
  handleEthosProxy,
  handleCatalog,
  handleIndexer,
  handleSearch,
  handleColumns,
  handleApis,
  handleFamilies,
  handleTables,
  handleLineage,
];
```

- [ ] **Step 3: Run typecheck + full test suite**

```bash
./bun.exe run typecheck && ./bun.exe test
```

Expected: typecheck clean; every test passes (proxy tests + env store tests + the rest of the suite). If typecheck complains about unused `EnvironmentStore` imports or similar, tidy them.

- [ ] **Step 4: Manual smoke test — proxy a real Ethos call**

The dev servers should already be running (5173 + 5757). In a browser console (on http://localhost:5173), paste:

```js
fetch("/api/ethos/api/persons?limit=1", { headers: { Accept: "application/vnd.hedtech.integration.v12+json" } }).then(r => r.json()).then(console.log);
```

Expected: either a 200 JSON list with one person (if the active env + API key are real), **or** a structured JSON error (`no-active-environment`, `no-api-key`, `auth-failed`, or `upstream-unreachable`). What you must NOT see: HTML from the SPA fallback, a 501, or an unstructured error.

If this is the first time a real call reaches Ethos, also verify:
- The `X-Proxy-Upstream-Status` response header is present.
- Response headers include `Content-Type` from the upstream.

If you see `no-active-environment` but an env exists, activate one via the Settings panel and retry.

- [ ] **Step 5: Commit**

```bash
git add server/proxy/ethos.ts server/routes/index.ts
git commit -m "$(cat <<'EOF'
feat: ethos proxy — dispatcher wiring + lazy boot

handleEthosProxy is a module-level RouteHandler that lazy-creates the
env store, secret store, token cache, and proxy factory on first
request, then delegates. Region is re-read per call so Settings changes
take effect without restart. onComplete is intentionally undefined here
— Phase 2 item 8 (request history) will wire the SQLite logger in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: PLAN.md cleanup

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Rewrite Phase 2 item 4**

Find the current Phase 2 item 4 line in `PLAN.md` (under `## Phase 2 — plan for next session`, numbered list, starts with `4. **Request proxy**`). Replace the entire item 4 line with:

```
4. **Request proxy** (`server/proxy/ethos.ts`) — `/api/ethos/<path>` forwards UI requests to `${regionBaseUrl}/<path>` with the env's cached Bearer JWT attached. Transparent method/body/header passthrough; 401 triggers a one-shot invalidate + retry. Exposes an `onComplete` hook (no-op here) for Phase 2 item 8 to wire SQLite `request_history` writes into.
```

- [ ] **Step 2: Trim the Try-APIs section summary**

Find the Try-APIs section (search for `## Try-APIs (locked in)`). Under **Per-profile fields:**, the current text lists `default headers (pre-populated on Add with Accept: application/json + Content-Type: application/json)` as a field. Replace the whole "Per-profile fields" sentence with:

```
- **Per-profile fields**: name, production flag, Ellucian API key (DPAPI-encrypted in the sibling `secrets.json`). Per-request headers live on the Try panel — environments carry credentials + connection, not content negotiation. The `production` flag is the sole safety setting — when true, the Try panel confirms non-GET requests; the request-history logger always redacts bodies regardless of env.
```

- [ ] **Step 3: Trim Phase 2 item 1**

Find Phase 2 item 1 (`1. **Environment profile manager**`). It currently mentions `default headers (pre-populated on Add with Accept/Content-Type = application/json)` as a per-profile field. Replace the `Fields per profile:` clause in that item with:

```
Fields per profile: name, production flag, API key.
```

(Leave the rest of the item — region handling, top-bar selector, `activeId` persistence, Settings gear — unchanged.)

- [ ] **Step 4: Commit**

```bash
git add PLAN.md
git commit -m "$(cat <<'EOF'
docs: PLAN.md — match shipped proxy + header relocation

Item 4 now describes /api/ethos/<path> + 401 one-shot retry + onComplete
hook. Environment profile no longer lists defaultHeaders as a field,
matching the code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification

After all tasks are committed, a final sanity pass:

- [ ] **Final: Run the full test suite and typecheck**

```bash
./bun.exe run typecheck && ./bun.exe test
```

Expected: clean typecheck, all tests pass (we should be at the original 86 + 1 new env-load test + ~15 new proxy tests ≈ 100+).

- [ ] **Final: Confirm a real end-to-end call still works**

Same browser-console test as Task 11 Step 4. If an active env + real API key are configured, verify you get live data back.

- [ ] **Final: Update `project_state.md` memory entry**

Update the `memory/project_state.md` file to reflect that Phase 2 item 4 is shipped (proxy + env-header cleanup), and the next step is Phase 2 item 5 (Try panel), with the EEDM `criteria={...}` flattening noted as a significant UX sub-problem.
