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
