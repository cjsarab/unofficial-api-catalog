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
        const hdrs = behavior.headers ?? { "content-type": "text/plain" };
        // If the behavior specifies gzip encoding, compress the body so Bun's
        // HTTP client doesn't throw a ZlibError on the plaintext bytes.
        const bodyBytes = hdrs["content-encoding"] === "gzip"
          ? Bun.gzipSync(new TextEncoder().encode(behavior.body))
          : behavior.body;
        return new Response(bodyBytes, { status: behavior.status, headers: hdrs });
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
});
