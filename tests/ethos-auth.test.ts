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
