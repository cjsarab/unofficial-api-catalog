import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openIndex } from "../server/indexer/sqlite.ts";
import { indexCatalog } from "../server/indexer/index.ts";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "small-catalog");

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `api-catalog-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
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

describe("indexer roundtrip against small-catalog fixture", () => {
  test("walks two families, parses three specs, emits metadata", async () => {
    const db = openIndex(dbPath);
    const stats = await indexCatalog(FIXTURE_ROOT, { db });

    expect(stats.total).toBe(3);
    expect(stats.inserted).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.familiesSeen.sort()).toEqual(["BannerBusAPIs", "BannerEedmAPIs"]);

    const apis = db
      .query<{ family: string; resource: string; version: string; release_status: string | null }, []>(
        `SELECT family, resource, version, release_status FROM apis ORDER BY family, resource, version`,
      )
      .all();
    expect(apis).toHaveLength(3);
    expect(apis[0]).toEqual({ family: "BannerBusAPIs", resource: "foo", version: "1.0.0", release_status: "ga" });
    expect(apis[1]).toEqual({ family: "BannerBusAPIs", resource: "foo", version: "2.0.0", release_status: "beta" });
    expect(apis[2]).toEqual({ family: "BannerEedmAPIs", resource: "bar", version: "6.0.0", release_status: "ga" });

    // endpoints
    const endpoints = db.query<{ c: number }, []>(`SELECT count(*) as c FROM endpoints`).get()?.c ?? 0;
    expect(endpoints).toBe(3); // one GET each

    db.close();
  });

  test("tokenizes x-lineageReferenceObject into columns + detects sentinels", async () => {
    const db = openIndex(dbPath);
    await indexCatalog(FIXTURE_ROOT, { db });

    // foo-1.0.0 has 3 fields with x-lineageReferenceObject:
    //   SPRIDEN_ID(SPRIDEN)                          → columns: SPRIDEN_ID; table: SPRIDEN
    //   SPRIDEN_LAST_NAME                            → columns: SPRIDEN_LAST_NAME
    //   SPRIDEN_PIDM where SPRIDEN_CHANGE_IND = 'I'  → columns: SPRIDEN_PIDM, SPRIDEN_CHANGE_IND
    // foo-2.0.0 has:
    //   SPRIDEN_ID                                   → columns: SPRIDEN_ID
    // bar-6.0.0 has:
    //   unsupported                                  → sentinel row (kind=unsupported)

    const distinctColumns = db
      .query<{ column_name: string }, []>(
        `SELECT DISTINCT column_name FROM columns WHERE kind = 'column' ORDER BY column_name`,
      )
      .all()
      .map((r) => r.column_name);
    expect(distinctColumns.sort()).toEqual([
      "SPRIDEN_CHANGE_IND",
      "SPRIDEN_ID",
      "SPRIDEN_LAST_NAME",
      "SPRIDEN_PIDM",
    ]);

    // SPRIDEN_ID appears in foo-1.0.0 AND foo-2.0.0 → 2 distinct APIs
    const spridenIdApis = db
      .query<{ c: number }, []>(
        `SELECT count(DISTINCT api_id) as c FROM columns WHERE column_name = 'SPRIDEN_ID' AND kind = 'column'`,
      )
      .get()?.c ?? 0;
    expect(spridenIdApis).toBe(2);

    // Sentinel row from bar-6.0.0 gets preserved for display.
    const sentinels = db
      .query<{ kind: string; api_id: number }, []>(
        `SELECT kind, api_id FROM columns WHERE kind = 'unsupported'`,
      )
      .all();
    expect(sentinels).toHaveLength(1);

    db.close();
  });

  test("creates lineage edges from x-lineageLookupReferenceObject with context-aware kind", async () => {
    const db = openIndex(dbPath);
    await indexCatalog(FIXTURE_ROOT, { db });

    const edges = db
      .query<{ to_kind: string; to_ref: string; from_family: string }, []>(
        `SELECT e.to_kind, e.to_ref, a.family AS from_family
         FROM lineage_edges e JOIN apis a ON a.id = e.from_api_id
         ORDER BY a.family, e.to_ref`,
      )
      .all();
    expect(edges).toHaveLength(2);

    // foo-1.0.0 (non-ethos Bus spec) → spriden should be classified as db-table.
    const fromBus = edges.find((e) => e.from_family === "BannerBusAPIs")!;
    expect(fromBus.to_ref).toBe("spriden");
    expect(fromBus.to_kind).toBe("db-table");

    // bar-6.0.0 (ethos EEDM spec) → persons should be classified as api-resource.
    const fromEedm = edges.find((e) => e.from_family === "BannerEedmAPIs")!;
    expect(fromEedm.to_ref).toBe("persons");
    expect(fromEedm.to_kind).toBe("api-resource");

    db.close();
  });

  test("stale-file cleanup removes rows for files that vanish between scans", async () => {
    const db = openIndex(dbPath);
    await indexCatalog(FIXTURE_ROOT, { db });
    const beforeApis = db.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c ?? 0;
    expect(beforeApis).toBe(3);

    // Simulate a partial catalog by running the indexer against only one family.
    const partialRoot = join(FIXTURE_ROOT, "..", "small-catalog-partial-" + Date.now());
    // Point at a single family-only root by using the BannerEedmAPIs dir as the
    // "catalog" — which has no "*APIs/" child, so no files walk. Easier: point
    // at the real fixture but after manually excluding one YAML via a separate
    // partial-fixtures dir. Simpler still: re-scan a different root with
    // fewer files.
    //
    // Instead, just point at an empty folder; stale cleanup should wipe the DB.
    // This mimics "user moved their catalog folder".
    await import("node:fs/promises").then(({ mkdir }) => mkdir(partialRoot, { recursive: true }));
    const stats = await indexCatalog(partialRoot, { db });

    expect(stats.total).toBe(0);
    expect(stats.removed).toBe(3);
    const afterApis = db.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c ?? 0;
    expect(afterApis).toBe(0);
    const afterCols = db.query<{ c: number }, []>(`SELECT count(*) as c FROM columns`).get()?.c ?? 0;
    expect(afterCols).toBe(0);
    const afterEdges = db.query<{ c: number }, []>(`SELECT count(*) as c FROM lineage_edges`).get()?.c ?? 0;
    expect(afterEdges).toBe(0);

    await rm(partialRoot, { recursive: true, force: true });
    db.close();
  });

  test("incremental re-scan skips unchanged files", async () => {
    const db = openIndex(dbPath);
    const first = await indexCatalog(FIXTURE_ROOT, { db });
    expect(first.inserted).toBe(3);
    expect(first.skipped).toBe(0);

    const second = await indexCatalog(FIXTURE_ROOT, { db });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.errors).toBe(0);
    expect(second.removed).toBe(0);

    db.close();
  });
});
