import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";

import { INDEX_PATH } from "../config.ts";

// node:sqlite is a Node 22.5+ experimental builtin. Vite 5's known-builtins
// list doesn't include it (it's the rare builtin that's "only-prefixed" —
// never appears in `module.builtinModules` without the `node:` prefix), so a
// static value-import from "node:sqlite" causes Vite/Vitest's transformer to
// strip the prefix and fail with "Failed to load url sqlite". The type-only
// import above is erased before runtime; the value is loaded via
// createRequire() which bypasses Vite's static analysis. Drop both halves
// once Vite recognises node:sqlite natively.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const SCHEMA_VERSION = 1;

// node:sqlite (Node 22.5+, experimental) is the chosen driver after the
// 2026-05-01 pivot off Bun. We expose a small wrapper so the rest of the
// codebase can keep using the bun:sqlite-style `db.query<T, A>(sql).get(...)`
// pattern without 50+ callsite rewrites. The wrapper also supplies a
// `transaction(fn)` helper since node:sqlite doesn't ship one (unlike
// bun:sqlite / better-sqlite3).

type SqlArg = string | number | bigint | null | Uint8Array | boolean | undefined;

export interface TypedStatement<T, A extends SqlArg[] = SqlArg[]> {
  get(...args: A): T | undefined;
  all(...args: A): T[];
  run(...args: A): { changes: number; lastInsertRowid: number | bigint };
}

export interface Database {
  readonly filename: string;
  exec(sql: string): void;
  query<T = unknown, A extends SqlArg[] = SqlArg[]>(sql: string): TypedStatement<T, A>;
  transaction<F extends (...args: never[]) => unknown>(fn: F): F;
  close(): void;
}

function wrap(raw: DatabaseSyncT, filename: string): Database {
  return {
    filename,
    exec: (sql) => raw.exec(sql),
    query: <T = unknown, A extends SqlArg[] = SqlArg[]>(sql: string) =>
      raw.prepare(sql) as unknown as TypedStatement<T, A>,
    transaction: <F extends (...args: never[]) => unknown>(fn: F): F => {
      const wrapped = ((...args: never[]) => {
        raw.exec("BEGIN");
        try {
          const result = fn(...args);
          raw.exec("COMMIT");
          return result;
        } catch (err) {
          // Best-effort rollback. If ROLLBACK itself fails (e.g. DB closed
          // mid-transaction), surface the original error, not the rollback's.
          try {
            raw.exec("ROLLBACK");
          } catch {
            /* ignored */
          }
          throw err;
        }
      }) as F;
      return wrapped;
    },
    close: () => raw.close(),
  };
}

export function openIndex(path: string = INDEX_PATH): Database {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA synchronous = NORMAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA temp_store = MEMORY");

  const db = wrap(raw, path);

  try {
    migrate(db);
  } catch (err) {
    // Don't leak the file handle if migrate refuses (e.g. downgrade) — without
    // this the SQLite file stays locked until the process exits, which breaks
    // any caller trying to delete + recreate the index.
    db.close();
    throw err;
  }

  // If the previous process was killed mid-scan, the meta row is stuck on
  // `running`. We're single-process, so any `running` we see on open is
  // necessarily stale — reclassify so the UI surfaces the interruption
  // instead of waiting forever for a phantom in-flight scan.
  const stuck = db
    .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'last_scan_status'`)
    .get();
  if (stuck?.value === "running") {
    db.query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_scan_status', 'aborted')`).run();
    db.query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_scan_finished_at', ?)`).run(String(Date.now()));
  }

  return db;
}

export function getMeta(db: Database, key: string): string | null {
  const row = db
    .query<{ value: string }, [string]>(`SELECT value FROM meta WHERE key = ?`)
    .get(key);
  return row ? row.value : null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.query(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(key, value);
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const row = db
    .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get();
  const current = row ? Number(row.value) : 0;

  // Refuse to silently downgrade. If the DB was written by a newer binary
  // (current > SCHEMA_VERSION), we don't know which tables/columns the future
  // schema added. Quietly running SCHEMA_V1 + writing schema_version=current-1
  // leaves the DB claiming an older version while still holding the newer
  // shape. Throwing forces the user to either reinstall the newer binary or
  // explicitly clear the index via /api/index/clear.
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Index DB has schema version ${current} but this binary only knows version ${SCHEMA_VERSION}. ` +
      `It looks like the catalog was indexed by a newer build. Either upgrade the app, or clear the ` +
      `index from Settings → Catalog (or delete data/index.sqlite*) and re-scan.`,
    );
  }

  // Forward-only migration. On a version bump we wipe-rebuild the content
  // tables — the catalog is the source of truth and re-indexing is fast.
  if (current > 0 && current < SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS request_history;
      DROP TABLE IF EXISTS columns_fts;
      DROP TABLE IF EXISTS api_fts;
      DROP TABLE IF EXISTS lineage_edges;
      DROP TABLE IF EXISTS columns;
      DROP TABLE IF EXISTS endpoints;
      DROP TABLE IF EXISTS apis;
      DROP TABLE IF EXISTS files;
    `);
  }

  // Always re-apply — every CREATE in SCHEMA_V1 is `IF NOT EXISTS`, so this is
  // idempotent on a fresh DB and self-healing on a half-migrated one (drops
  // happened but recreate didn't).
  db.exec(SCHEMA_V1);

  if (current !== SCHEMA_VERSION) {
    db.query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`).run(
      String(SCHEMA_VERSION),
    );
  }
}

const SCHEMA_V1 = /* sql */ `
  CREATE TABLE IF NOT EXISTS files (
    path          TEXT PRIMARY KEY,
    mtime         INTEGER NOT NULL,
    size          INTEGER NOT NULL,
    last_indexed  INTEGER,
    parse_status  TEXT NOT NULL DEFAULT 'pending',
    error         TEXT
  );

  CREATE TABLE IF NOT EXISTS apis (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    family         TEXT NOT NULL,
    resource       TEXT NOT NULL,
    version        TEXT NOT NULL,
    title          TEXT,
    description    TEXT,
    source_system  TEXT,
    source_domain  TEXT,
    source_title   TEXT,
    api_type       TEXT,
    release_status TEXT,
    audience       TEXT,
    file_path      TEXT NOT NULL UNIQUE,
    indexed_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS apis_family_idx        ON apis(family);
  CREATE INDEX IF NOT EXISTS apis_resource_idx      ON apis(resource);
  CREATE INDEX IF NOT EXISTS apis_source_system_idx ON apis(source_system);
  CREATE INDEX IF NOT EXISTS apis_source_domain_idx ON apis(source_domain);

  CREATE TABLE IF NOT EXISTS endpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    api_id       INTEGER NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    method       TEXT NOT NULL,
    summary      TEXT,
    description  TEXT,
    operation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS endpoints_api_idx ON endpoints(api_id);

  CREATE TABLE IF NOT EXISTS columns (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    column_name    TEXT NOT NULL,
    table_name     TEXT,
    source_system  TEXT,
    api_id         INTEGER NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    endpoint_id    INTEGER REFERENCES endpoints(id) ON DELETE CASCADE,
    field_path     TEXT NOT NULL,
    raw_expression TEXT NOT NULL,
    kind           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS columns_name_idx  ON columns(column_name);
  CREATE INDEX IF NOT EXISTS columns_table_idx ON columns(table_name);
  CREATE INDEX IF NOT EXISTS columns_api_idx   ON columns(api_id);

  CREATE TABLE IF NOT EXISTS lineage_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_api_id INTEGER NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
    to_kind     TEXT NOT NULL,
    to_ref      TEXT NOT NULL,
    field_path  TEXT
  );
  CREATE INDEX IF NOT EXISTS lineage_from_idx ON lineage_edges(from_api_id);
  CREATE INDEX IF NOT EXISTS lineage_to_idx   ON lineage_edges(to_ref);

  CREATE VIRTUAL TABLE IF NOT EXISTS api_fts USING fts5 (
    family, resource, version, title, description,
    source_system, source_domain, source_title, api_type, release_status,
    content='apis', content_rowid='id', tokenize='unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS apis_ai AFTER INSERT ON apis BEGIN
    INSERT INTO api_fts (rowid, family, resource, version, title, description,
                         source_system, source_domain, source_title, api_type, release_status)
    VALUES (new.id, new.family, new.resource, new.version,
            coalesce(new.title,''), coalesce(new.description,''),
            coalesce(new.source_system,''), coalesce(new.source_domain,''),
            coalesce(new.source_title,''), coalesce(new.api_type,''),
            coalesce(new.release_status,''));
  END;
  CREATE TRIGGER IF NOT EXISTS apis_ad AFTER DELETE ON apis BEGIN
    INSERT INTO api_fts (api_fts, rowid, family, resource, version, title, description,
                         source_system, source_domain, source_title, api_type, release_status)
    VALUES ('delete', old.id, old.family, old.resource, old.version,
            coalesce(old.title,''), coalesce(old.description,''),
            coalesce(old.source_system,''), coalesce(old.source_domain,''),
            coalesce(old.source_title,''), coalesce(old.api_type,''),
            coalesce(old.release_status,''));
  END;

  CREATE VIRTUAL TABLE IF NOT EXISTS columns_fts USING fts5 (
    column_name, table_name, source_system,
    content='columns', content_rowid='id', tokenize='unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS columns_ai AFTER INSERT ON columns BEGIN
    INSERT INTO columns_fts (rowid, column_name, table_name, source_system)
    VALUES (new.id, new.column_name, coalesce(new.table_name,''), coalesce(new.source_system,''));
  END;
  CREATE TRIGGER IF NOT EXISTS columns_ad AFTER DELETE ON columns BEGIN
    INSERT INTO columns_fts (columns_fts, rowid, column_name, table_name, source_system)
    VALUES ('delete', old.id, old.column_name, coalesce(old.table_name,''), coalesce(old.source_system,''));
  END;

  CREATE TABLE IF NOT EXISTS request_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     INTEGER NOT NULL,
    env_id        TEXT NOT NULL,
    method        TEXT NOT NULL,
    path          TEXT NOT NULL,
    status        INTEGER,
    duration_ms   INTEGER,
    body_redacted TEXT,
    response_body TEXT
  );
  CREATE INDEX IF NOT EXISTS history_timestamp_idx ON request_history(timestamp DESC);
`;
