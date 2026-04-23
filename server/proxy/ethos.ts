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
}
