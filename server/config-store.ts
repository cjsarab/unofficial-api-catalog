import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";

import { APP_DATA_DIR, APP_VERSION, CONFIG_PATH } from "./config.ts";
import { type Region, isValidRegion } from "./environments/region.ts";

export interface AppConfig {
  /** Absolute path to the APICatalog folder. Undefined until the user picks one. */
  catalogPath?: string;
  /** Most-recently-used paths (newest first), excluding the current catalogPath. */
  recentPaths: string[];
  /** Version that last wrote this file (for migrations). */
  lastWrittenByVersion: string;
  /** Workspace-level Ellucian region (singleton — one per user). */
  region: Region;
}

const DEFAULT_CONFIG: AppConfig = {
  recentPaths: [],
  lastWrittenByVersion: APP_VERSION,
  region: "us",
};

function ensureDir() {
  if (!existsSync(APP_DATA_DIR)) mkdirSync(APP_DATA_DIR, { recursive: true });
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const text = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(text) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      recentPaths: Array.isArray(parsed.recentPaths) ? parsed.recentPaths.slice(0, 16) : [],
      region: isValidRegion(parsed.region) ? parsed.region : "us",
    };
  } catch {
    return { ...DEFAULT_CONFIG, recentPaths: [] };
  }
}

/**
 * Drop any `recentPaths` entries that no longer point at a readable directory.
 * Writes the pruned list back to disk if anything changed. Cheap enough to run
 * on every `/api/config` fetch — saves the UI from showing stale ghosts.
 */
export async function pruneRecentPaths(): Promise<AppConfig> {
  const current = await loadConfig();
  const kept: string[] = [];
  for (const p of current.recentPaths) {
    if (!p) continue;
    try {
      const s = await stat(p);
      if (s.isDirectory()) kept.push(p);
    } catch {
      // missing / unreachable → drop
    }
  }
  if (kept.length === current.recentPaths.length) return current;
  const next: AppConfig = { ...current, recentPaths: kept };
  await saveConfig(next);
  return next;
}

export async function saveConfig(next: AppConfig): Promise<void> {
  ensureDir();
  const payload: AppConfig = { ...next, lastWrittenByVersion: APP_VERSION };
  await writeFile(CONFIG_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

/**
 * Set a new catalog path. The previous path (if any and different) is prepended
 * to `recentPaths`, de-duplicated, capped at 8 entries.
 */
export async function setCatalogPath(path: string): Promise<AppConfig> {
  const current = await loadConfig();
  const trimmed = path.trim();

  if (!trimmed) return current;

  const next: AppConfig = { ...current, catalogPath: trimmed };

  if (current.catalogPath && current.catalogPath !== trimmed) {
    const recent = [current.catalogPath, ...current.recentPaths.filter((p) => p !== current.catalogPath && p !== trimmed)];
    next.recentPaths = recent.slice(0, 8);
  } else {
    next.recentPaths = current.recentPaths.filter((p) => p !== trimmed).slice(0, 8);
  }

  await saveConfig(next);
  return next;
}

export async function clearCatalogPath(): Promise<AppConfig> {
  const current = await loadConfig();
  const next: AppConfig = { ...current };
  if (current.catalogPath && !next.recentPaths.includes(current.catalogPath)) {
    next.recentPaths = [current.catalogPath, ...current.recentPaths].slice(0, 8);
  }
  delete next.catalogPath;
  await saveConfig(next);
  return next;
}

export async function setRegion(region: Region): Promise<AppConfig> {
  const current = await loadConfig();
  const next: AppConfig = { ...current, region };
  await saveConfig(next);
  return next;
}
