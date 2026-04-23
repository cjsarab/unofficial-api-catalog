import { openIndex } from "./indexer/sqlite.ts";

// Lazy-opened SQLite handle, shared across all route modules. The file isn't
// created until the first caller asks for it.
let _db: ReturnType<typeof openIndex> | undefined;

export function db() {
  if (!_db) _db = openIndex();
  return _db;
}

/**
 * Detach the cached handle and return it. Used by /api/index/clear which needs
 * to close + delete the SQLite files; subsequent calls to db() will open a fresh
 * connection instead of grabbing the soon-to-be-closed one.
 */
export function detachDb(): ReturnType<typeof openIndex> {
  const handle = _db ?? openIndex();
  _db = undefined;
  return handle;
}

/**
 * Close the cached handle if open. Used by the shutdown signal handlers so
 * SQLite can checkpoint the WAL cleanly and not leave -shm/-wal orphans.
 */
export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch (err) {
      console.error("Error closing DB:", (err as Error).message);
    }
    _db = undefined;
  }
}
