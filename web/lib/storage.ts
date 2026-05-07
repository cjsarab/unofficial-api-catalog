/**
 * Centralised localStorage keys + safe wrappers.
 *
 * All keys live here so a future v2 schema bump can be coordinated across
 * the four currently-stored blobs (theme, layout, sidebar, family-expand)
 * with a single migration function. Wrapper helpers swallow quota /
 * SecurityError exceptions — every read returns the supplied fallback,
 * every write is best-effort.
 *
 * Theme is stored as a plain string for backward compatibility with the
 * previous direct localStorage.setItem(key, value) calls. The other keys
 * store JSON.
 */

export const STORAGE_KEYS = {
  theme: "acx:theme:v1",
  layout: "acx:layout:v1",
  sidebar: "acx:sidebar:v1",
  familyExpanded: "acx:family-expanded:v1",
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

/** Read a JSON-serialised value. Returns `fallback` on miss / parse error. */
export function getStored<T>(key: StorageKey, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Write a JSON-serialised value. Best-effort — quota / SecurityError swallowed. */
export function setStored<T>(key: StorageKey, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Read a raw string value (no JSON parse). Returns `fallback` on miss. */
export function getStoredString(key: StorageKey, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write a raw string value (no JSON encode). Best-effort. */
export function setStoredString(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
