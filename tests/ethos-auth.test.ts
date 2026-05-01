import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";

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

  const server = serve({
    port: 0,
    fetch: async (req) => {
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

  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://localhost:${addr.port}`,
    get callCount() { return callCount; },
    setResponse(r: { status: number; body: string }) { currentResponse = r; },
    stop() {
      return new Promise<void>((res) => server.close(() => res()));
    },
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

  afterEach(async () => {
    await fixture.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("getJwt fetches and returns a JWT for a valid env", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env",
      production: false,
      apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    const { jwt } = await cache.getJwt(env.id);

    expect(jwt).toBe(SAMPLE_JWT);
    expect(fixture.callCount).toBe(1);
  });

  test("second call returns cached JWT without re-fetching", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    const first = await cache.getJwt(env.id);
    const second = await cache.getJwt(env.id);

    expect(second.jwt).toBe(first.jwt);
    expect(fixture.callCount).toBe(1);
  });

  test("invalidate() forces a fresh fetch", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await cache.getJwt(env.id);
    cache.invalidate(env.id);
    await cache.getJwt(env.id);

    expect(fixture.callCount).toBe(2);
  });

  test("authMs: non-zero on cache miss, zero on cache hit", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, apiKey: API_KEY,
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    const first = await cache.getJwt(env.id);
    expect(first.jwt).toBeDefined();
    expect(first.authMs).toBeGreaterThan(0);
    expect(fixture.callCount).toBe(1);

    const second = await cache.getJwt(env.id);
    expect(second.jwt).toBe(first.jwt);
    expect(second.authMs).toBe(0);
    expect(fixture.callCount).toBe(1);                 // still 1 — cache hit, no fresh fetch
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
      name: "test-env", production: false, apiKey: "placeholder",
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
      name: "test-env", production: false, apiKey: "wrong-key",
    });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await expect(cache.getJwt(env.id)).rejects.toThrow(/auth request failed.*401/i);
  });

  test("malformed JWT body surfaces an error", async () => {
    const secrets = createSecretStore(secretPath);
    const envStore = createEnvironmentStore(envPath, secrets);
    const env = envStore.add({
      name: "test-env", production: false, apiKey: API_KEY,
    });

    fixture.setResponse({ status: 200, body: "not-a-jwt" });

    const cache = createTokenCache(envStore, secrets, () => fixture.baseUrl);
    await expect(cache.getJwt(env.id)).rejects.toThrow(/not a JWT/i);
  });
});
