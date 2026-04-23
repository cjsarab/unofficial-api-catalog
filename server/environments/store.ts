import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SecretStore } from "../auth/secrets.ts";

export interface Environment {
  id: string;
  name: string;
  production: boolean;
}

export interface EnvironmentWithStatus extends Environment {
  hasApiKey: boolean;
}

export interface CreateEnvironmentInput {
  name: string;
  production: boolean;
  apiKey: string;
}

export interface UpdateEnvironmentInput {
  name?: string;
  production?: boolean;
  apiKey?: string;
}

export interface EnvironmentStore {
  list(): { envs: EnvironmentWithStatus[]; activeId: string | null };
  get(id: string): EnvironmentWithStatus | null;
  getApiKey(id: string): string | null;
  add(input: CreateEnvironmentInput): EnvironmentWithStatus;
  update(id: string, input: UpdateEnvironmentInput): EnvironmentWithStatus;
  delete(id: string): void;
  setActive(id: string): void;
}

// On-disk shape. `activeId` is null when no env is active.
interface DiskState {
  envs: Environment[];
  activeId: string | null;
}

const SECRET_KEY = (id: string) => `env/${id}/api_key`;


export function createEnvironmentStore(
  filePath: string,
  secretStore: SecretStore,
): EnvironmentStore {
  let cache: DiskState | undefined;

  function load(): DiskState {
    if (cache !== undefined) return cache;
    if (!existsSync(filePath)) {
      cache = { envs: [], activeId: null };
      return cache;
    }
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error(`Failed to read ${filePath}: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${filePath} is not valid JSON: ${(err as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON object`);
    }
    const p = parsed as Partial<DiskState>;
    if (!Array.isArray(p.envs)) {
      throw new Error(`${filePath} is missing or has invalid 'envs' array`);
    }
    const activeIdRaw = typeof p.activeId === "string" ? p.activeId : null;
    // If activeId points at an env that no longer exists (file hand-edited, or
    // crash between env-list write and later operations), coerce to null rather
    // than letting a dangling reference hide bugs downstream.
    const activeId = activeIdRaw && p.envs.some((e) => e.id === activeIdRaw) ? activeIdRaw : null;
    // Strip legacy fields we no longer carry. `defaultHeaders` moved to the
    // Try panel in Phase 2 item 4; old environments.json files still have it.
    const sanitized: Environment[] = p.envs.map((raw) => {
      const e = raw as Environment & { defaultHeaders?: unknown };
      return { id: e.id, name: e.name, production: e.production };
    });
    cache = { envs: sanitized, activeId };
    return cache;
  }

  function flush(): void {
    if (!cache) return;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
    renameSync(tmp, filePath);
  }

  function decorate(env: Environment): EnvironmentWithStatus {
    return { ...env, hasApiKey: secretStore.listSecretKeys().includes(SECRET_KEY(env.id)) };
  }

  return {
    list() {
      const s = load();
      return { envs: s.envs.map(decorate), activeId: s.activeId };
    },
    get(id) {
      const s = load();
      const env = s.envs.find((e) => e.id === id);
      return env ? decorate(env) : null;
    },
    getApiKey(id) {
      const s = load();
      if (!s.envs.some((e) => e.id === id)) {
        throw new Error(`environment "${id}" not found`);
      }
      return secretStore.getSecret(SECRET_KEY(id));
    },
    add(input) {
      const s = load();
      const name = input.name.trim();
      if (!name) throw new Error("name must not be empty");
      if (s.envs.some((e) => e.name === name)) {
        throw new Error(`an environment named "${name}" already exists`);
      }
      if (!input.apiKey) throw new Error("apiKey must not be empty");

      const env: Environment = {
        id: crypto.randomUUID(),
        name,
        production: input.production,
      };
      s.envs.push(env);
      flush();
      secretStore.setSecret(SECRET_KEY(env.id), input.apiKey);
      return decorate(env);
    },
    update(id, input) {
      const s = load();
      const env = s.envs.find((e) => e.id === id);
      if (!env) throw new Error(`environment "${id}" not found`);

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new Error("name must not be empty");
        if (s.envs.some((e) => e.id !== id && e.name === name)) {
          throw new Error(`an environment named "${name}" already exists`);
        }
        env.name = name;
      }
      if (input.production !== undefined) env.production = input.production;

      flush();

      if (input.apiKey !== undefined) {
        if (!input.apiKey) throw new Error("apiKey must not be empty");
        secretStore.setSecret(SECRET_KEY(env.id), input.apiKey);
      }

      return decorate(env);
    },
    delete(id) {
      const s = load();
      const idx = s.envs.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`environment "${id}" not found`);
      s.envs.splice(idx, 1);
      if (s.activeId === id) s.activeId = null;
      flush();
      // Secret cleanup is best-effort from a durability standpoint (see spec
      // "Delete / rename semantics"): the env record is already gone, so a
      // leftover secret key is orphaned-but-harmless.
      secretStore.deleteSecret(SECRET_KEY(id));
    },
    setActive(id) {
      const s = load();
      if (!s.envs.some((e) => e.id === id)) {
        throw new Error(`environment "${id}" not found`);
      }
      s.activeId = id;
      flush();
    },
  };
}
