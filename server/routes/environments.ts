import type { RouteHandler } from "./types.ts";
import { SECRETS_PATH, ENVIRONMENTS_PATH } from "../config.ts";
import { createSecretStore } from "../auth/secrets.ts";
import {
  createEnvironmentStore,
  type EnvironmentStore,
  type CreateEnvironmentInput,
  type UpdateEnvironmentInput,
} from "../environments/store.ts";

// Singleton. Bun's FFI / DPAPI handles are effectively free; the real cost
// is file reads on first call, which the store caches internally.
let store: EnvironmentStore | undefined;
function getStore(): EnvironmentStore {
  if (!store) {
    const secrets = createSecretStore(SECRETS_PATH);
    store = createEnvironmentStore(ENVIRONMENTS_PATH, secrets);
  }
  return store;
}

function err(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export const handleEnvironments: RouteHandler = async (req, url) => {
  if (!url.pathname.startsWith("/api/environments")) return undefined;

  const rest = url.pathname.slice("/api/environments".length); // "" | "/<id>" | "/<id>/activate"

  // GET /api/environments
  if (rest === "" && req.method === "GET") {
    try {
      return Response.json(getStore().list());
    } catch (e) {
      return err((e as Error).message, 500);
    }
  }

  // POST /api/environments
  if (rest === "" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as Partial<CreateEnvironmentInput> | null;
    if (!body) return err("malformed JSON body", 400);
    try {
      const created = getStore().add({
        name: String(body.name ?? ""),
        production: Boolean(body.production),
        apiKey: String(body.apiKey ?? ""),
      });
      return Response.json(created, { status: 201 });
    } catch (e) {
      return err((e as Error).message, 400);
    }
  }

  // GET /api/environments/:id/api-key — returns the decrypted key for reveal.
  // Local single-user desktop app, localhost-only — exposing the plaintext
  // here is the same trust boundary as the form where the user typed it in.
  {
    const apiKeyMatch = rest.match(/^\/([^\/]+)\/api-key$/);
    if (apiKeyMatch && req.method === "GET") {
      const id = decodeURIComponent(apiKeyMatch[1]!);
      try {
        const key = getStore().getApiKey(id);
        if (key === null) return err("no api key set for this environment", 404);
        return Response.json({ apiKey: key });
      } catch (e) {
        const msg = (e as Error).message;
        return err(msg, /not found/i.test(msg) ? 404 : 500);
      }
    }
  }

  // Paths below all match "/<id>..." — pull the id.
  const m = rest.match(/^\/([^\/]+)(\/activate)?$/);
  if (!m) return err("not found", 404);
  const id = decodeURIComponent(m[1]!);
  const isActivate = !!m[2];

  // POST /api/environments/:id/activate
  if (isActivate && req.method === "POST") {
    try {
      getStore().setActive(id);
      return Response.json({ activeId: id });
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 400);
    }
  }

  // PATCH /api/environments/:id
  if (!isActivate && req.method === "PATCH") {
    const body = (await req.json().catch(() => null)) as Partial<UpdateEnvironmentInput> | null;
    if (!body) return err("malformed JSON body", 400);
    try {
      const updated = getStore().update(id, body);
      return Response.json(updated);
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 400);
    }
  }

  // DELETE /api/environments/:id
  if (!isActivate && req.method === "DELETE") {
    try {
      getStore().delete(id);
      return new Response(null, { status: 204 });
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 500);
    }
  }

  return undefined; // fall through to the dispatcher's 501 for unmatched methods
};
