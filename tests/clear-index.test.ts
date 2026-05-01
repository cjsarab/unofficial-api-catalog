import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openIndex } from "../server/indexer/sqlite.ts";
import { clearIndexFiles } from "../server/indexer/index.ts";

const TEST_DIR = join(tmpdir(), "api-catalog-clear-" + Date.now());

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("clearIndexFiles", () => {
  test("deletes the sqlite backing file and lets a reopen recreate it empty", async () => {
    const dbPath = join(TEST_DIR, "idx.sqlite");
    const db = openIndex(dbPath);

    // Seed a row so we can assert clearing actually removed data.
    db.exec(
      `INSERT INTO files (path, mtime, size, parse_status) VALUES ('/foo.yaml', 1, 100, 'ok')`,
    );
    db.exec(
      `INSERT INTO apis (family, resource, version, file_path, indexed_at) VALUES ('X', 'foo', '1.0.0', '/foo.yaml', 0)`,
    );
    expect(db.query<{ c: number }, []>("SELECT count(*) as c FROM files").get()?.c).toBe(1);
    expect(db.query<{ c: number }, []>("SELECT count(*) as c FROM apis").get()?.c).toBe(1);
    expect(existsSync(dbPath)).toBe(true);

    const result = await clearIndexFiles(db);
    expect(result.files).toBe(1);
    expect(result.apis).toBe(1);
    // After clear, the backing file is gone.
    expect(existsSync(dbPath)).toBe(false);
    expect(result.paths.some((p) => p.endsWith("idx.sqlite"))).toBe(true);

    // Reopen re-creates with a clean schema.
    const db2 = openIndex(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    expect(db2.query<{ c: number }, []>("SELECT count(*) as c FROM files").get()?.c).toBe(0);
    expect(db2.query<{ c: number }, []>("SELECT count(*) as c FROM apis").get()?.c).toBe(0);
    db2.close();
  });

  test("tolerates a DB where the WAL/SHM companions don't exist", async () => {
    const dbPath = join(TEST_DIR, "bare.sqlite");
    const db = openIndex(dbPath);
    // Force a checkpoint so there's no WAL data, then close.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const result = await clearIndexFiles(db);
    // At least the main file should have been removed.
    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(dbPath)).toBe(false);
  });
});
