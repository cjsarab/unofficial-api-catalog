import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SecretStore {
  setSecret(key: string, value: string): void;
  getSecret(key: string): string | null;
  deleteSecret(key: string): void;
  listSecretKeys(): string[];
}

// On-disk shape: { "<caller-chosen key>": "<plaintext value>" }.
// Secrets used to be DPAPI-encrypted; the trust model is now "single-user
// localhost desktop app with secrets in a gitignored repo file" and the
// encryption layer was removed. The on-disk path (data/secrets.json) is
// covered by .gitignore via both `/data/*` and `secrets.json` rules.
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
      map[key] = value;
      flush();
    },

    getSecret(key) {
      const map = load();
      return map[key] ?? null;
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
