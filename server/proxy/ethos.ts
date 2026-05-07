import type { EnvironmentStore } from "../environments/store.ts";
import type { TokenCache } from "../auth/ethos.ts";
import type { RouteHandler } from "../routes/types.ts";
import { createEnvironmentStore } from "../environments/store.ts";
import { createSecretStore } from "../auth/secrets.ts";
import { createTokenCache } from "../auth/ethos.ts";
import { SECRETS_PATH, ENVIRONMENTS_PATH } from "../config.ts";
import { regionToBaseUrl } from "../environments/region.ts";
import { loadConfig } from "../config-store.ts";

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

// Response-side headers to strip. Bun's fetch has already decoded the body,
// so advertising the upstream encoding would mislead the client.
const RESPONSE_DROP = new Set(["content-encoding", "transfer-encoding"]);

function shapeResponseHeaders(src: Headers, upstreamStatus: number): Headers {
  const out = new Headers();
  // append, not set — preserves repeated headers like Set-Cookie /
  // WWW-Authenticate / Link, which Headers.forEach visits once per value.
  src.forEach((value, name) => {
    if (RESPONSE_DROP.has(name.toLowerCase())) return;
    out.append(name, value);
  });
  out.set("X-Proxy-Upstream-Status", String(upstreamStatus));
  return out;
}

function filterIncomingHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DROP_EXACT.has(lower)) return;
    if (DROP_PREFIX.some((p) => lower.startsWith(p))) return;
    out.append(name, value);
  });
  return out;
}

function classifyFetchError(err: unknown): Response {
  const detail = err instanceof Error ? err.message : String(err);
  // Heuristic: the token cache wraps its own fetch failures with "auth fetch failed"
  // or "auth request failed"; anything else is an upstream fetch rejection.
  if (/auth (fetch|request) failed|auth response/i.test(detail)) {
    return Response.json({ error: "auth-failed", detail }, { status: 502 });
  }
  return Response.json({ error: "upstream-unreachable", detail }, { status: 502 });
}

function headersToObject(h: Headers, redactAuth: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = redactAuth && k.toLowerCase() === "authorization" ? "Bearer ***" : v;
  });
  return out;
}

export function createEthosProxy(opts: EthosProxyOptions): RouteHandler {
  return async (req, url) => {
    if (!url.pathname.startsWith(PREFIX + "/") && url.pathname !== PREFIX) return undefined;
    const suffix = url.pathname.slice(PREFIX.length);
    const path = (suffix || "/") + url.search;

    const listed = opts.envStore.list();
    if (!listed.activeId) {
      return Response.json({ error: "no-active-environment" }, { status: 400 });
    }
    const activeId = listed.activeId;

    const env = opts.envStore.get(activeId);
    if (!env || !env.hasApiKey) {
      return Response.json({ error: "no-api-key", envId: activeId }, { status: 400 });
    }

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
  };
}

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
