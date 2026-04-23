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

export function createEthosProxy(opts: EthosProxyOptions): RouteHandler {
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

    const outgoingHeaders = filterIncomingHeaders(req.headers);
    outgoingHeaders.set("Authorization", `Bearer ${jwt}`);

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: incomingBody ?? undefined,
    });
    const body = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(body, {
      status: upstreamRes.status,
      headers: shapeResponseHeaders(upstreamRes.headers, upstreamRes.status),
    });
  };
}
