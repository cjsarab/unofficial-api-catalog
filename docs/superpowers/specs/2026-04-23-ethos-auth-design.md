# Ethos API Key → JWT Exchange — Design

**Date:** 2026-04-23
**Status:** Pending approval
**Phase:** 2 — item 3

## Goal

Exchange each env's DPAPI-stored API key for a short-lived Ellucian Ethos JWT, cache it in RAM, and refresh on demand. Consumed by the upcoming request proxy (Phase 2 item 4) on every outbound API call.

## Auth flow

1. Caller asks for a JWT for a specific `envId`.
2. We read the env record (existence, name — just to sanity-check the id).
3. We read the API key from the DPAPI secret store at `env/<envId>/api_key`.
4. We read the workspace `region` from `config.json` via the config store.
5. POST `${regionBaseUrl}/auth` with `Authorization: Bearer <api_key>` and empty body.
6. Response body is a plaintext JWT string. Ellucian's server-side TTL is 5 minutes by default.
7. Cache the JWT per `envId` with `expiresAt = Date.now() + 4 * 60 * 1000` (5-minute server TTL minus a 60-second safety margin).
8. Subsequent calls within the window return the cached JWT; after, we re-fetch.

**Why not extend with `?expirationMinutes=N`:** Ellucian supports extending TTL up to 120 minutes, but 5 minutes is the safer default. No reason to reach for the longer window until a real requirement emerges.

## Module

`server/auth/ethos.ts`, ~80 lines.

```ts
import type { EnvironmentStore } from "../environments/store.ts";
import type { SecretStore } from "./secrets.ts";
import type { Region } from "../environments/region.ts";

export interface TokenCache {
  /** Returns a valid JWT for the given env, fetching fresh if expired or invalidated. */
  getJwt(envId: string): Promise<string>;
  /** Drops the cached JWT for the given env. Next getJwt forces a fresh fetch. */
  invalidate(envId: string): void;
}

export function createTokenCache(
  envStore: EnvironmentStore,
  secretStore: SecretStore,
  regionGetter: () => Region,
): TokenCache;
```

- Factory takes the env store (to look up env existence), the secret store (for API key retrieval), and a `regionGetter` function (a function rather than a static value so the region can change at runtime without re-creating the cache).
- Closure holds a `Map<envId, { jwt: string; expiresAt: number }>`.
- No network code beyond a single `fetch` call; no external libraries.

## Error handling

- **Unknown envId** → `throw new Error("environment \"<id>\" not found")`.
- **No API key stored** → `throw new Error("no API key set for environment \"<id>\"")`.
- **Network failure** (fetch rejects) → rethrow wrapped: `throw new Error("auth fetch failed: <cause>")`.
- **Auth endpoint non-2xx** → `throw new Error("auth request failed: <status> <body snippet>")`.
- **Empty/invalid response body** → `throw new Error("auth response was empty / not a JWT")`. Simple sanity check: body must be non-empty and match `/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/` (three base64url-ish segments separated by dots).

The proxy (item 4) will handle 401 recovery by calling `invalidate(envId)` then `getJwt(envId)` to force a refresh and retry.

## Tests

`tests/ethos-auth.test.ts` (new file). Uses a Bun-launched fixture HTTP server on a random port, closed after each test.

Fixture server behaviour:
- `POST /auth` with `Authorization: Bearer <known-valid-key>` → returns a plaintext JWT body (three dotted base64url segments) with status 200.
- Any other auth presentation → 401 with an error body.
- Supports a toggle to simulate network failure (close the server).

Test cases:

1. **Happy path — first call fetches and caches.** Assert the returned JWT matches the fixture-issued one and that the fixture received exactly one request.
2. **Second call returns cached** (no new fetch request observed).
3. **`invalidate()` forces refresh** — after invalidate, the next `getJwt` hits the fixture again.
4. **Unknown envId throws** the not-found message.
5. **Env exists but no API key** throws the no-key message.
6. **Wrong API key (401 from auth)** throws the auth-request-failed message with status 401.
7. **Malformed JWT body** (fixture returns `"not-a-jwt"`) throws the not-a-JWT message.

(Time-based expiry isn't directly tested — `invalidate()` covers the refresh path. A clock-injection path can be added later if we ever suspect a TTL bug.)

## Integration (no code yet, just noted for the proxy slice)

The proxy (item 4) will create the token cache once at server boot using the existing stores and a `regionGetter` that reads from config. Every outbound API call:

```ts
const jwt = await tokenCache.getJwt(envId);
const res = await fetch(targetUrl, { headers: { Authorization: `Bearer ${jwt}` } });
if (res.status === 401) {
  tokenCache.invalidate(envId);
  const freshJwt = await tokenCache.getJwt(envId);
  // retry once with freshJwt...
}
```

## Out of scope for this slice

- `/api/auth/test` HTTP route and its consumer UI ("Test connection" button) — deferred; user flagged it as unnecessary for now.
- `?expirationMinutes=` extended-TTL knob — Ellucian supports it, not using it.
- JWT `exp`-claim decoding — server-side TTL is known; decoding would only let us trust the server's expiry exactly, and our 4-minute safety margin is conservative enough.
- In-flight request deduplication — single-user desktop app; two concurrent `getJwt` calls for the same env would cause a redundant fetch, not a correctness issue.
- Disk persistence of JWTs — short-lived tokens; fresh fetch on app boot is fine.
- Any UI surface (banner on auth failure, retry button, etc.) — belongs to the Try-panel slice or the proxy slice.

## PLAN.md cleanup

One small edit to PLAN.md L506:

Current:
```
3. **Ellucian API key → JWT exchange** (`server/auth/ethos.ts`) — POST the stored API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth`, receive plaintext JWT, cache in RAM for `TTL - 60s`, refresh on 401. `/api/auth/test` endpoint for the "Test connection" button.
```

Replace the trailing sentence: drop the `/api/auth/test` endpoint reference (deferred). Something like:
```
3. **Ellucian API key → JWT exchange** (`server/auth/ethos.ts`) — POST the stored API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth`, receive plaintext JWT, cache in RAM per env for `TTL - 60s`, `invalidate()` forces refresh. Consumed by the request proxy (item 4) — no HTTP surface of its own. "Test connection" UI deferred.
```
