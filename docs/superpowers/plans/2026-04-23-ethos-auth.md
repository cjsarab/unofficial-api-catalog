# Ethos API Key → JWT Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory token cache module that exchanges a stored Ellucian API key for a short-lived JWT against the region-derived `/auth` endpoint. Consumed later by the request proxy (Phase 2 item 4).

**Architecture:** Single module `server/auth/ethos.ts` exposing a factory `createTokenCache(envStore, secretStore, baseUrlGetter)` that returns `{ getJwt(envId), invalidate(envId) }`. Cache is a `Map<envId, { jwt, expiresAt }>`; 4-minute TTL (5-min server TTL minus a 60 s safety margin). No HTTP surface of its own.

**Tech Stack:** Bun, TypeScript (strict + verbatimModuleSyntax), `bun:test`, `Bun.serve` for the in-process fixture, built-in `fetch`.

**Spec:** `docs/superpowers/specs/2026-04-23-ethos-auth-design.md`

**Repo state:** This project is now a git repo (initial commit `011b892`). Tasks that change code each end with `git commit` steps — use small, logical commits. Test fixtures and code together; PLAN.md cleanup in its own commit.

**API shape tweak vs. spec:** the spec's design section sketched `regionGetter: () => Region` in the factory signature. For testability we pass `baseUrlGetter: () => string` directly — production code wraps `() => regionToBaseUrl(loadConfig().region)`, tests wrap `() => fixtureUrl`. Same semantics, one less indirection per call.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `server/auth/ethos.ts` | Create (~90 lines) | `TokenCache` interface + `createTokenCache(envStore, secretStore, baseUrlGetter)` factory. |
| `tests/ethos-auth.test.ts` | Create (~180 lines, 7 tests) | Integration tests using an in-process `Bun.serve` fixture. |
| `PLAN.md` | Modify (1 edit) | Update Phase 2 item 3 wording — drop `/api/auth/test` reference (deferred). |

---

## Task 1: Fixture helper + first failing test (happy path)

**Files:**
- Create: `tests/ethos-auth.test.ts`

- [ ] **Step 1: Write the test file with fixture helper + the happy-path test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSecretStore } from "../server/auth/secrets.ts";
import { createEnvironmentStore } from "../server/environments/store.ts";
import { createTokenCache } from "../server/auth/ethos.ts";

// A sample JWT that passes the "three base64url segments" structural check.
const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig-placeholder";

/**
 * Tiny fixture server: `POST /auth` with `Authorization: Bearer <expectedKey>`
 * → 200 text/plain body containing `SAMPLE_JWT`. Anything else → 401.
 * Track call count for "cache hit" assertions.
 */
function startFixture(expectedKey: string) {
  let callCount = 0;
  let currentResponse: { status: number; body: string } = { status: 200, body: SAMPLE_JWT };

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/auth" && req.method === "POST") {
        callCount++;
        const auth = req.headers.get("Authorization");
        if (auth === `Bearer ${expectedKey}`) {
          return new Response(currentResponse.body, {
            status: currentResponse.status,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response("unauthorized", { status: 401 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    get callCount() { return callCount; },
    setResponse(r: { status: number; body: string }) { currentResponse = r; },
    stop() { server.stop(true); },
  };
}

describe("ethos auth token cache", () => {
  let dir: string;
  let envPath: string;
  let secretPath: string;
  let fixture: ReturnType<typeof startFixture>;

  const API_KEY = "test-api-key-abc123";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acx-ethos-test-"));
    envPath = join(dir, "environments.json");
    secretPath = join(dir, "secrets.json");
    fixture = startFixture(API_KEY);
  });

  afterEach(() => {
    fixture.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("getJwt fetches and returns a JWT for a valid env", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env",
      production: false,
      defaultHeaders: {},
      apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    const jwt = await cache.getJwt(env.id);

    expect(jwt).toBe(SAMPLE_JWT);
    expect(fixture.callCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm module-resolution failure**

Run: `./bun.exe test tests/ethos-auth.test.ts`
Expected: `Cannot find module '../server/auth/ethos.ts'`. Any other failure (typo, fixture issue) → fix first.

- [ ] **Step 3: Commit**

```bash
git add tests/ethos-auth.test.ts
git commit -m "test: add ethos auth fixture + failing happy-path test"
```

---

## Task 2: Scaffold `ethos.ts` — happy path

**Files:**
- Create: `server/auth/ethos.ts`

- [ ] **Step 1: Write the module**

```ts
import type { EnvironmentStore } from "../environments/store.ts";
import type { SecretStore } from "./secrets.ts";

export interface TokenCache {
  /** Returns a valid JWT for the given env, fetching fresh if expired or invalidated. */
  getJwt(envId: string): Promise<string>;
  /** Drops the cached JWT for the given env. Next getJwt forces a fresh fetch. */
  invalidate(envId: string): void;
}

// Ellucian's default server-side JWT TTL is 5 minutes; we cache for 4 minutes
// to guarantee the cached token is still accepted when used.
const CACHE_TTL_MS = 4 * 60 * 1000;

// Structural sanity check — three base64url segments separated by dots.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const SECRET_KEY = (id: string) => `env/${id}/api_key`;

interface CacheEntry {
  jwt: string;
  expiresAt: number;
}

export function createTokenCache(
  envStore: EnvironmentStore,
  secretStore: SecretStore,
  baseUrlGetter: () => string,
): TokenCache {
  const cache = new Map<string, CacheEntry>();

  async function fetchFresh(envId: string): Promise<string> {
    if (!envStore.get(envId)) {
      throw new Error(`environment "${envId}" not found`);
    }
    const apiKey = secretStore.getSecret(SECRET_KEY(envId));
    if (!apiKey) {
      throw new Error(`no API key set for environment "${envId}"`);
    }

    const url = `${baseUrlGetter()}/auth`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      throw new Error(`auth fetch failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`auth request failed: ${res.status} ${snippet}`);
    }

    const body = (await res.text()).trim();
    if (!body || !JWT_SHAPE.test(body)) {
      throw new Error(`auth response was empty / not a JWT: "${body.slice(0, 60)}"`);
    }

    cache.set(envId, { jwt: body, expiresAt: Date.now() + CACHE_TTL_MS });
    return body;
  }

  return {
    async getJwt(envId) {
      const hit = cache.get(envId);
      if (hit && hit.expiresAt > Date.now()) return hit.jwt;
      return fetchFresh(envId);
    },
    invalidate(envId) {
      cache.delete(envId);
    },
  };
}
```

- [ ] **Step 2: Run the happy-path test**

Run: `./bun.exe test tests/ethos-auth.test.ts`
Expected: **1 pass / 0 fail**.

- [ ] **Step 3: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail** (79 pre-existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add server/auth/ethos.ts
git commit -m "feat: ethos token cache — happy-path getJwt"
```

---

## Task 3: Remaining 6 tests — cache hit, invalidate, errors

**Files:**
- Modify: `tests/ethos-auth.test.ts`

The `ethos.ts` implementation in Task 2 already covers all error paths; we just assert them.

- [ ] **Step 1: Append these 6 tests inside the existing `describe` block**

```ts
  test("second call returns cached JWT without re-fetching", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, defaultHeaders: {}, apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    const first = await cache.getJwt(env.id);
    const second = await cache.getJwt(env.id);

    expect(second).toBe(first);
    expect(fixture.callCount).toBe(1);
  });

  test("invalidate() forces a fresh fetch", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, defaultHeaders: {}, apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await cache.getJwt(env.id);
    cache.invalidate(env.id);
    await cache.getJwt(env.id);

    expect(fixture.callCount).toBe(2);
  });

  test("unknown envId throws not-found error", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);

    await expect(cache.getJwt("does-not-exist")).rejects.toThrow(/not found/i);
    expect(fixture.callCount).toBe(0);
  });

  test("env without API key throws no-key error", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    // Add an env, then manually nuke its secret.
    const env = envStore.add({
      name: "test-env", production: false, defaultHeaders: {}, apiKey: "placeholder",
    });
    secrets.deleteSecret(`env/${env.id}/api_key`);

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await expect(cache.getJwt(env.id)).rejects.toThrow(/no API key/i);
    expect(fixture.callCount).toBe(0);
  });

  test("auth endpoint 401 surfaces an error", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, defaultHeaders: {}, apiKey: "wrong-key",
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await expect(cache.getJwt(env.id)).rejects.toThrow(/auth request failed.*401/i);
  });

  test("malformed JWT body surfaces an error", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, defaultHeaders: {}, apiKey: API_KEY,
    });

    fixture.setResponse({ status: 200, body: "not-a-jwt" });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await expect(cache.getJwt(env.id)).rejects.toThrow(/not a JWT/i);
  });
```

- [ ] **Step 2: Run the full auth test file**

Run: `./bun.exe test tests/ethos-auth.test.ts`
Expected: **7 pass / 0 fail**.

- [ ] **Step 3: Full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **86 pass / 0 fail** (79 + 7 new).

- [ ] **Step 4: Commit**

```bash
git add tests/ethos-auth.test.ts
git commit -m "test: ethos token cache — cache/invalidate/error paths"
```

---

## Task 4: PLAN.md cleanup + real-key smoke instructions

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Edit the Phase 2 item 3 line**

Replace:
```
3. **Ellucian API key → JWT exchange** (`server/auth/ethos.ts`) — POST the stored API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth`, receive plaintext JWT, cache in RAM for `TTL - 60s`, refresh on 401. `/api/auth/test` endpoint for the "Test connection" button.
```

with:

```
3. **Ellucian API key → JWT exchange** (`server/auth/ethos.ts`) — POST the stored API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth`, receive plaintext JWT, cache in RAM per env for 4 minutes (5-minute server TTL minus 60-second safety margin). `invalidate()` forces refresh on downstream 401. Consumed by the request proxy (item 4) — no HTTP surface of its own. "Test connection" UI deferred.
```

- [ ] **Step 2: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **86 pass / 0 fail** (pure docs change — nothing moves).

- [ ] **Step 3: Commit**

```bash
git add PLAN.md
git commit -m "docs: align PLAN.md with shipped ethos auth module"
```

- [ ] **Step 4: Hand off smoke-test instructions to the user**

After this task, the controller should tell the user to verify against the real Ellucian auth endpoint. Paste this guidance into the final report:

> **Live smoke test (optional):**
>
> 1. In the browser, open Settings → Environments, add an env with your real Ellucian API key, save it.
> 2. Note the env's `id` — open DevTools / Network tab during a list fetch to see it, or look inside `%APPDATA%\api-catalog-explorer\environments.json`.
> 3. In a terminal (from the repo root), run:
>    ```bash
>    ./bun.exe -e "
>      import { createSecretStore } from './server/auth/secrets.ts';
>      import { createEnvironmentStore } from './server/environments/store.ts';
>      import { createTokenCache } from './server/auth/ethos.ts';
>      import { loadConfig } from './server/config-store.ts';
>      import { regionToBaseUrl } from './server/environments/region.ts';
>      import { SECRETS_PATH, ENVIRONMENTS_PATH } from './server/config.ts';
>      const secrets = createSecretStore(SECRETS_PATH);
>      const envs = createEnvironmentStore(ENVIRONMENTS_PATH, secrets);
>      const config = await loadConfig();
>      const cache = createTokenCache(envs, secrets, () => regionToBaseUrl(config.region));
>      const envId = '<paste-env-id-here>';
>      const jwt = await cache.getJwt(envId);
>      console.log('OK — JWT length:', jwt.length, 'first 40:', jwt.slice(0, 40));
>    "
>    ```
> 4. Expected: `OK — JWT length: <some number>` with a first-40 prefix like `eyJhbGci...`. If you see `auth request failed: 401` you've got the wrong API key or wrong region; anything else is a bug to investigate.

---

## Done condition

After Task 4:
- `server/auth/ethos.ts` exists; exposes `createTokenCache` returning `TokenCache`.
- `tests/ethos-auth.test.ts` has 7 tests, all passing.
- Full suite: **86 pass / 0 fail**, typecheck clean.
- PLAN.md Phase 2 item 3 line reflects shipped behaviour.
- User has the smoke-test recipe in hand for live verification.
- The module is ready to be consumed by the next Phase 2 slice (request proxy, item 4).
