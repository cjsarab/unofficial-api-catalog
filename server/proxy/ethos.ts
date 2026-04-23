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
  src.forEach((value, name) => {
    if (RESPONSE_DROP.has(name.toLowerCase())) return;
    out.set(name, value);
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
    out.set(name, value);
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
  };
}
