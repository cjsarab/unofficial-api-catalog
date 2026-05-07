import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { protect, unprotect } from "./dpapi.ts";

export interface SecretStore {
  setSecret(key: string, value: string): void;
  getSecret(key: string): string | null;
  deleteSecret(key: string): void;
  listSecretKeys(): string[];
}

// On-disk shape: { "<caller-chosen key>": "<base64 DPAPI ciphertext>" }
type SecretMap = Record<string, string>;

export function createSecretStore(filePath: string): SecretStore {
  // Module-level cache populated on first call. Mutations write through to disk.
  // Scope is per-store-instance, not per-process — fresh createSecretStore()
  // re-reads the file (this is what makes the persistence test work).
  let cache: SecretMap | undefined;

  function load(): SecretMap {
    if (cache !== undefined) return cache;
    if (!existsSync(filePath)) {
      cache = {};
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
    cache = parsed as SecretMap;
    return cache;
  }

  function flush(): void {
    if (!cache) return;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Atomic write: tmp + rename. fs.renameSync uses MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING on Windows so it overwrites atomically.
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
    renameSync(tmp, filePath);
  }

  return {
    setSecret(key, value) {
      const map = load();
      map[key] = protect(value).toString("base64");
      flush();
    },

    getSecret(key) {
      const map = load();
      const b64 = map[key];
      if (b64 === undefined) return null;
      return unprotect(Buffer.from(b64, "base64"));
    },

    deleteSecret(key) {
      const map = load();
      if (key in map) {
        delete map[key];
        flush();
      }
    },

    listSecretKeys() {
      return Object.keys(load());
    },
  };
}
