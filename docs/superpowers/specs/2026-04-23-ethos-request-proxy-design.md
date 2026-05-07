# Ethos Request Proxy — Design

**Date:** 2026-04-23
**Status:** Pending approval
**Phase:** 2 — item 4

## Goal

Forward UI-issued HTTP requests from the Try panel to the user's Ellucian Ethos tenant, attaching the right JWT, handling stale-token refresh, and emitting a completion event that the (still-to-build) request-history slice will consume. The proxy solves CORS, keeps the API key away from the browser, and is the single natural capture point for timing + outcome logging.

## URL scheme

`/api/ethos/<path>` — the catch-all suffix after `/api/ethos/` (including the query string) is forwarded verbatim to `${regionBaseUrl}/<path>?<query>`.

- Namespace carved out under `/api/ethos/*` so there's no future route-collision risk with real Ethos paths.
- Devtools + `Copy as curl` see real HTTP semantics end-to-end (method, status, query, content-type).
- Path is not URL-decoded — browser-encoded bytes arrive at Ethos untouched.

## Passthrough rules

**Method** — any verb the client sent (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`). Forwarded verbatim.

**Body** — buffered once into a `Uint8Array`, forwarded verbatim on both the original call and any 401 retry. Buffering (rather than streaming) keeps the `onComplete` hook simple and avoids a stream-tee; the app is local-only and we're not dealing with multi-GB uploads.

**Query string** — forwarded verbatim.

## Headers

**Outgoing to Ethos** (later wins):

1. Incoming request's headers *minus* a strip list:
   - Hop-by-hop: `Host`, `Connection`, `Content-Length`, `Transfer-Encoding`
   - Browser-added: `Origin`, `Referer`, any `Sec-Fetch-*`, `Cookie`, any `Proxy-*`
   - Security: the incoming `Authorization` header is always dropped (we inject our own)
2. `Authorization: Bearer <jwt>` — always last so it can't be overridden.

The Try panel (item 5) will own the per-request header editor. The Environment profile no longer carries `defaultHeaders` — content negotiation is a request-level concern (see "Environment schema change" below).

**Response back to client** — pass through, minus `Transfer-Encoding` and `Content-Encoding` (Bun's fetch has already decoded the body, so forwarding the upstream encoding would mislead the client). One sidecar header added:

- `X-Proxy-Upstream-Status` — the original upstream status *before* any 401 retry. Equal to the final status unless a retry fired. Useful for the Response panel's Timing/Headers tab and keeps the audit trail honest.

## Request flow

```
1. Pull the active envId from envStore.list().activeId. If null → 400 no-active-environment.
2. Verify the env has an API key (envStore.get(id).hasApiKey). If not → 400 no-api-key.
3. Await tokenCache.getJwt(envId). On throw → 502 auth-failed with detail.
4. Buffer the incoming body (null if no body / zero-length).
5. Build outgoing Request: method + url (${baseUrl}/<path>?<query>) + merged headers + body.
6. Measure start time. Call fetch(). On fetch rejection → 502 upstream-unreachable with detail.
7. If upstream returned 401:
   a. tokenCache.invalidate(envId)
   b. Re-fetch JWT via getJwt(envId) (on throw → 502 auth-failed)
   c. Replay the exact same outgoing request with the fresh Bearer.
   d. Final response is whatever step c returned — do not retry again on 401.
8. Read the response body into a Uint8Array (for the hook).
9. Build the client-facing Response (status, filtered headers + X-Proxy-Upstream-Status, body) and the ProxyCompleteEvent.
10. Call `onComplete(event)` fire-and-forget — do not await. If it returns a promise, attach a `.catch()` so an unhandled rejection in the hook can never crash the server. The default no-op hook returns synchronously; item 8's hook will be async (SQLite write) but the client never waits on it.
11. Return the Response to the client.
```

Only 401 triggers a retry. Every other status (403, 404, 5xx, …) passes through untouched.

## Error mapping

| Failure | Status | Body |
|---|---|---|
| No active env | 400 | `{error: "no-active-environment"}` |
| Active env has no API key | 400 | `{error: "no-api-key", envId}` |
| `tokenCache.getJwt` throws | 502 | `{error: "auth-failed", detail}` |
| `fetch` to Ethos rejects (DNS / connection refused / TLS) | 502 | `{error: "upstream-unreachable", detail}` |
| Ethos returns a response | upstream status | raw body passthrough |

Error bodies are JSON (`content-type: application/json`) so the Response panel can render proxy-level errors consistently alongside real Ethos responses.

## Module shape

`server/proxy/ethos.ts`, ~180 lines.

```ts
import type { EnvironmentStore } from "../environments/store.ts";
import type { TokenCache } from "../auth/ethos.ts";
import type { RouteHandler } from "../routes/types.ts";

export interface ProxyCompleteEvent {
  envId: string;
  method: string;
  path: string;                            // "/<remainder>" with query string
  upstreamUrl: string;                     // fully-resolved URL we called
  requestHeaders: Record<string, string>;  // outgoing headers, Authorization redacted to "Bearer ***"
  requestBody: Uint8Array | null;
  status: number;                          // final status (after any retry)
  upstreamStatus: number;                  // pre-retry status
  responseHeaders: Record<string, string>;
  responseBody: Uint8Array;
  durationMs: number;                      // wall time from handler entry to response ready
  retried: boolean;                        // true if 401 retry path fired
}

export interface EthosProxyOptions {
  envStore: EnvironmentStore;
  tokenCache: TokenCache;
  baseUrlGetter: () => string;             // same getter tokenCache uses
  onComplete?: (event: ProxyCompleteEvent) => void;
}

export function createEthosProxy(opts: EthosProxyOptions): RouteHandler;
```

Integrates into `server/routes/index.ts` like every other route handler. The proxy's handler matches `/api/ethos/*` and falls through (returns `undefined`) for anything else.

## Environment schema change

`defaultHeaders` is removed from `Environment`, `CreateEnvironmentInput`, and `UpdateEnvironmentInput` in `server/environments/store.ts`. Content negotiation moves to the Try panel (item 5).

**On-disk compatibility:** existing `environments.json` files will still have a `defaultHeaders` field on each env entry. The `load()` function is updated to strip the field from each env object as it builds the in-memory cache, so the first `flush()` after load (or on any subsequent write) rewrites the file without it. No separate migration code, no user-visible step.

UI change: `web/settings/EnvironmentsPanel.svelte` loses the default-headers row. The corresponding fields in its create/update payloads go away.

Test updates: any assertions on `defaultHeaders` in `tests/environment-store.test.ts` (and any wizard/UI tests that pass it) are updated.

## Tests

`tests/ethos-proxy.test.ts` (new file). Pattern mirrors the ethos-auth tests: an in-process `Bun.serve` fixture plays the role of Ethos upstream.

Fixture support:
- Default handler returns a JSON body echoing `{method, path, query, headers, body}` so tests can assert on what actually arrived upstream.
- Overrides per test: status code, response body/headers, an "auth-sequence" mode where the first call for a path returns 401 and subsequent calls return 200.
- An "always 401" mode for the second-401 test.

Test cases:

1. **Happy GET** — `/api/ethos/persons?limit=10` reaches upstream as `${baseUrl}/persons?limit=10`, Bearer present, response body + status + content-type flow back unchanged. `X-Proxy-Upstream-Status: 200` present.
2. **Happy POST with JSON body** — body bytes arrive verbatim; client-sent `Content-Type: application/json` arrives on the upstream request.
3. **Client header passthrough** — incoming `Accept: application/vnd.hedtech.integration.v16+json` reaches upstream intact.
4. **Authorization stripping** — a client-sent `Authorization: Bearer abc` is dropped; only the cache's JWT appears upstream.
5. **Strip-list pruning** — `Host`, `Origin`, `Cookie`, `Sec-Fetch-Site`, `Proxy-Connection` on the incoming request do not appear upstream.
6. **Response decoding headers stripped** — upstream's `Transfer-Encoding` / `Content-Encoding` not forwarded to client.
7. **401 retry — success on retry** — upstream 401 → `tokenCache.invalidate` called → second fetch uses a fresh JWT → upstream 200 → client sees 200, `X-Proxy-Upstream-Status: 401`, hook event has `retried: true` and `upstreamStatus: 401` / `status: 200`.
8. **401 retry — still 401** — both attempts 401 → client sees 401, `retried: true`, no third attempt.
9. **No active env** → 400 `no-active-environment`.
10. **Active env has no API key** → 400 `no-api-key` with envId.
11. **`tokenCache.getJwt` throws** (simulated by pointing baseUrl at a closed port) → 502 `auth-failed`.
12. **Upstream fetch rejects** (simulated by closing the fixture server mid-test) → 502 `upstream-unreachable`.
13. **Hook event shape** — happy call fires `onComplete` once with full event; `requestHeaders.Authorization === "Bearer ***"`; `requestBody` matches what was sent; `durationMs` > 0.
14. **Hook does not block the response** — set `onComplete` to an async function that sleeps 100ms before flipping a flag; assert the client-side fetch resolves while the flag is still false (verifies the fire-and-forget call).
15. **Hook rejection does not crash** — set `onComplete` to an async function that throws; assert a subsequent proxy call still succeeds (verifies the `.catch()` swallows unhandled rejections).

Separately — `tests/environment-store.test.ts` gets small edits to drop `defaultHeaders` from fixtures and any assertions.

## Integration at server boot

`server.ts` already constructs `envStore`, `secretStore`, and (once item 3 lands — it has) `tokenCache`. This slice adds:

```ts
const ethosProxy = createEthosProxy({
  envStore,
  tokenCache,
  baseUrlGetter: () => regionToBaseUrl(configStore.get().region),
  onComplete: () => {}, // no-op until item 8 wires SQLite request_history
});
```

…and registers `ethosProxy` in `server/routes/index.ts` alongside the other `handle*` route handlers.

## TODO — item 8 wire-up reminder

When Phase 2 item 8 (request history) is picked up, the only proxy-side change needed is swapping the no-op `onComplete` for a function that:
- Redacts request body (bodies are already unshaped `Uint8Array` — item 8 owns the redaction heuristic).
- Writes a row into the `request_history` SQLite table.
- Triggers a WebSocket/SSE notification to the sidebar History tab so the row appears without refresh.

No structural change to the proxy; the hook event shape defined above is the full contract.

## Out of scope

- Request-history persistence and UI — item 8.
- Response body streaming — buffer-and-forward is fine for this tool.
- Response-size caps — belongs with item 8 (that's where a huge body matters, because it goes into SQLite).
- Request deduplication / cancellation — the Try panel (item 5) will wire `AbortController` later; the proxy itself doesn't need explicit cancel wiring beyond `req.signal` propagation.
- Non-Ethos proxying — only Ellucian Ethos is in scope for this app.
- `onComplete` async-queueing semantics beyond fire-and-forget — if item 8 needs backpressure (bounded queue, retry on failed SQLite write, etc.), it can add that inside its hook implementation. The proxy's contract is "we call you once per request; you're on your own after that."

## PLAN.md cleanup

PLAN.md has already been updated in one place — item 5 picked up the `criteria=` object-param flattening note and a sentence clarifying that per-request headers live in the Try panel.

One more small edit: item 4's current line:

```
4. **Request proxy** (`server/proxy/ethos.ts`) — forwards UI requests to `${regionBaseUrl}/<path>` with Bearer + the env's `defaultHeaders` attached. Logs timings, captures response.
```

Should become something like:

```
4. **Request proxy** (`server/proxy/ethos.ts`) — `/api/ethos/<path>` forwards UI requests to `${regionBaseUrl}/<path>` with the env's cached Bearer JWT attached. Transparent method/body/header passthrough; 401 triggers a one-shot invalidate + retry. Exposes an `onComplete` hook (no-op for this slice) for the later request-history slice (item 8) to wire SQLite writes into.
```

Plus: item 1 ("Environment profile manager") currently lists `default headers (pre-populated on Add with Accept/Content-Type = application/json)` as a per-profile field. That wording is retired as part of this slice — the per-profile fields become just `name`, `production flag`, `API key`. The one-line `Environment profile manager` summary earlier in PLAN.md (Try-APIs section, lines ~243–244) needs the same trim.
