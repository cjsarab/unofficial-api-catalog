import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openIndex, getMeta } from "../server/indexer/sqlite.ts";
import {
  indexCatalog,
  META_LAST_SCAN_STATUS,
  META_LAST_SCAN_STARTED,
  META_LAST_SCAN_FINISHED,
  META_LAST_SCAN_ERROR,
} from "../server/indexer/index.ts";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "small-catalog");

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `api-catalog-abort-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
});

afterEach(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      await unlink(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("indexCatalog scan-status tracking", () => {
  test("clean scan records status='complete' with start/finish timestamps", async () => {
    const db = openIndex(dbPath);
    const before = Date.now();
    await indexCatalog(FIXTURE_ROOT, { db });
    const after = Date.now();

    expect(getMeta(db, META_LAST_SCAN_STATUS)).toBe("complete");
    const startedAt = Number(getMeta(db, META_LAST_SCAN_STARTED));
    const finishedAt = Number(getMeta(db, META_LAST_SCAN_FINISHED));
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(finishedAt).toBeGreaterThanOrEqual(startedAt);
    expect(finishedAt).toBeLessThanOrEqual(after);
    // Empty error string is the cleared sentinel.
    expect(getMeta(db, META_LAST_SCAN_ERROR)).toBe("");

    db.close();
  });

  test("aborted scan records status='aborted' and rejects with the abort reason", async () => {
    const db = openIndex(dbPath);
    const ctrl = new AbortController();
    // Abort before the loop ever sees a file — the per-iteration
    // throwIfAborted() check must trip on the first file.
    ctrl.abort();

    let caught: unknown;
    try {
      await indexCatalog(FIXTURE_ROOT, { db, signal: ctrl.signal });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();

    expect(getMeta(db, META_LAST_SCAN_STATUS)).toBe("aborted");
    expect(getMeta(db, META_LAST_SCAN_FINISHED)).not.toBeNull();
    // No catalog rows on a hard pre-abort.
    const apiCount = db.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c ?? 0;
    expect(apiCount).toBe(0);

    db.close();
  });

  test("reopening a DB stuck on status='running' reclassifies to 'aborted'", () => {
    // Simulate a server kill mid-scan: status row sticks on 'running' because
    // indexCatalog never reached its complete/error finally block. On the next
    // launch openIndex() must clean this up so the UI doesn't wait forever
    // for a phantom in-flight scan.
    const db1 = openIndex(dbPath);
    db1.query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_scan_status', 'running')`).run();
    db1.close();

    const db2 = openIndex(dbPath);
    expect(getMeta(db2, META_LAST_SCAN_STATUS)).toBe("aborted");
    expect(getMeta(db2, META_LAST_SCAN_FINISHED)).not.toBeNull();
    db2.close();
  });
});
