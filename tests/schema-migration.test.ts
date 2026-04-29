import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openIndex } from "../server/indexer/sqlite.ts";

const TEST_DIR = join(tmpdir(), "api-catalog-schema-mig-" + Date.now());

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

function tableNames(db: ReturnType<typeof openIndex>): Set<string> {
  const rows = db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'`,
    )
    .all();
  return new Set(rows.map((r) => r.name));
}

const CONTENT_TABLES = ["files", "apis", "endpoints", "columns", "lineage_edges", "request_history"];

describe("migrate", () => {
  test("creates all content tables on a fresh DB and records schema_version", () => {
    const dbPath = join(TEST_DIR, "fresh.sqlite");
    const db = openIndex(dbPath);

    const tables = tableNames(db);
    for (const t of CONTENT_TABLES) {
      expect(tables.has(t)).toBe(true);
    }
    expect(tables.has("meta")).toBe(true);

    const v = db
      .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get();
    expect(v?.value).toBe("1");

    db.close();
  });

  test("re-opening an up-to-date DB is a no-op (data preserved)", () => {
    const dbPath = join(TEST_DIR, "noop.sqlite");

    const db1 = openIndex(dbPath);
    db1.exec(
      `INSERT INTO apis (family, resource, version, file_path, indexed_at) VALUES ('X', 'foo', '1.0.0', '/foo.yaml', 0)`,
    );
    db1.close();

    const db2 = openIndex(dbPath);
    const count = db2.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c;
    expect(count).toBe(1);
    db2.close();
  });

  test("self-heals a half-migrated DB where content tables were dropped but schema_version was already bumped", () => {
    // This simulates the B-004 bug-state: in the buggy migrate(), a 1→2+
    // bump would DROP the content tables, the early-return + `current < 1`
    // guard would skip recreating SCHEMA_V1, and the version row would still
    // get updated to the new SCHEMA_VERSION. We simulate the same end-state
    // (tables gone, version row matches SCHEMA_VERSION) and assert that
    // re-running migrate() now restores the tables instead of leaving the
    // DB permanently broken.
    const dbPath = join(TEST_DIR, "half.sqlite");

    const db1 = openIndex(dbPath);
    // Drop all the content tables (and their FTS triggers) — leave meta + version
    // row in place so migrate() sees a "fully migrated" version marker.
    db1.exec(`
      DROP TABLE IF EXISTS request_history;
      DROP TABLE IF EXISTS columns_fts;
      DROP TABLE IF EXISTS api_fts;
      DROP TABLE IF EXISTS lineage_edges;
      DROP TABLE IF EXISTS columns;
      DROP TABLE IF EXISTS endpoints;
      DROP TABLE IF EXISTS apis;
      DROP TABLE IF EXISTS files;
    `);
    const tablesAfterDrop = tableNames(db1);
    for (const t of CONTENT_TABLES) {
      expect(tablesAfterDrop.has(t)).toBe(false);
    }
    db1.close();

    // Re-open — migrate() must self-heal.
    const db2 = openIndex(dbPath);
    const tablesAfterReopen = tableNames(db2);
    for (const t of CONTENT_TABLES) {
      expect(tablesAfterReopen.has(t)).toBe(true);
    }
    db2.close();
  });
});
