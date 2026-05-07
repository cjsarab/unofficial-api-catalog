import type { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";

import { openIndex } from "./sqlite.ts";
import { walkCatalog, parseResourceFolderName, type WalkedFile } from "./walker.ts";
import { parseSpec, type ParsedSpec } from "./parser.ts";
import type { LineageAnnotation } from "./lineage.ts";

export interface IndexProgress {
  total: number;
  processed: number;
  inserted: number;
  skipped: number;
  errors: number;
  currentFile?: string;
  durationMs: number;
}

export interface IndexStats extends IndexProgress {
  familiesSeen: string[];
  /** Number of rows removed because the on-disk file no longer exists. */
  removed: number;
}

/**
 * Scan a catalog root and upsert every API into SQLite.
 *
 * Uses mtime + size as the freshness check: if we already indexed a file
 * with the same (mtime, size, parse_status='ok'), we skip parsing. On any
 * change, we re-parse and replace.
 */
export async function indexCatalog(
  rootDir: string,
  opts: { db?: Database; onProgress?: (p: IndexProgress) => void } = {},
): Promise<IndexStats> {
  const db = opts.db ?? openIndex();
  const start = Date.now();

  const stats: IndexStats = {
    total: 0,
    processed: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    removed: 0,
    durationMs: 0,
    familiesSeen: [],
  };
  const familySet = new Set<string>();
  const scanStartedAt = Date.now();

  // First pass: enumerate all files so the UI can show a total.
  const files: WalkedFile[] = [];
  for await (const f of walkCatalog(rootDir)) files.push(f);
  stats.total = files.length;

  const selectFile = db.query<
    { mtime: number; size: number; parse_status: string } | null,
    [string]
  >(`SELECT mtime, size, parse_status FROM files WHERE path = ?`);

  const upsertFile = db.query(`
    INSERT INTO files (path, mtime, size, last_indexed, parse_status, error)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      mtime        = excluded.mtime,
      size         = excluded.size,
      last_indexed = excluded.last_indexed,
      parse_status = excluded.parse_status,
      error        = excluded.error
  `);

  // On skip (file unchanged), we still bump last_indexed so the stale-cleanup
  // pass at the end of the scan can tell "I saw this on disk" apart from
  // "this file no longer exists".
  const touchFile = db.query(`UPDATE files SET last_indexed = ? WHERE path = ?`);

  const deleteApiByPath = db.query(`DELETE FROM apis WHERE file_path = ?`);
  const insertApi = db.query<{ id: number }, [
    string, string, string, string | null, string | null,
    string | null, string | null, string | null, string | null,
    string | null, string | null, string, number,
  ]>(`
    INSERT INTO apis (
      family, resource, version, title, description,
      source_system, source_domain, source_title, api_type,
      release_status, audience, file_path, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const insertEndpoint = db.query(`
    INSERT INTO endpoints (api_id, path, method, summary, description, operation_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertColumn = db.query<
    never,
    [string, string | null, string | null, number, string, string, string]
  >(`
    INSERT INTO columns (column_name, table_name, source_system, api_id, field_path, raw_expression, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLineageEdge = db.query<
    never,
    [number, string, string, string | null]
  >(`
    INSERT INTO lineage_edges (from_api_id, to_kind, to_ref, field_path)
    VALUES (?, ?, ?, ?)
  `);

  // One synchronous transaction per file to keep writes consistent. Parsing is
  // async, so we do it outside the transaction.
  const applyParsed = db.transaction(
    (
      file: (typeof files)[number],
      parsed: Awaited<ReturnType<typeof parseSpec>>,
    ) => {
      const { resource, version } = parseResourceFolderName(file.resourceFolder);

      deleteApiByPath.run(file.path);

      if (parsed.parseError) {
        upsertFile.run(
          file.path, file.mtimeMs, file.size, Date.now(), "error", parsed.parseError,
        );
        return { outcome: "error" as const };
      }

      const apiRow = insertApi.get(
        file.family,
        resource,
        parsed.specVersion ?? version,
        parsed.title ?? null,
        parsed.description ?? null,
        parsed.sourceSystem ?? null,
        parsed.sourceDomain ?? null,
        parsed.sourceTitle ?? null,
        parsed.apiType ?? null,
        parsed.releaseStatus ?? null,
        parsed.audience ?? null,
        file.path,
        Date.now(),
      );

      if (apiRow) {
        for (const ep of parsed.endpoints) {
          insertEndpoint.run(
            apiRow.id, ep.path, ep.method,
            ep.summary ?? null, ep.description ?? null, ep.operationId ?? null,
          );
        }
        writeLineage(apiRow.id, parsed);
      }

      upsertFile.run(file.path, file.mtimeMs, file.size, Date.now(), "ok", null);
      return { outcome: "ok" as const };
    },
  );

  function writeLineage(apiId: number, parsed: ParsedSpec) {
    const specSource = parsed.sourceSystem?.toLowerCase();
    const isEthosSpec =
      parsed.apiType?.toLowerCase() === "ethos";

    for (const ann of parsed.lineage) {
      writeLineageAnnotation(apiId, ann, specSource, isEthosSpec);
    }
  }

  function writeLineageAnnotation(
    apiId: number,
    ann: LineageAnnotation,
    specSource: string | undefined,
    isEthosSpec: boolean,
  ) {
    const rawForColumns = ann.refRaw ?? ann.lookupRaw ?? "";

    // Column rows from x-lineageReferenceObject token extraction.
    for (const token of ann.tokens) {
      if (token.kind !== "column") continue;
      insertColumn.run(
        token.value,
        token.qualifiedTable ?? null,
        specSource ?? token.sourceSystemHint ?? null,
        apiId,
        ann.fieldPath,
        rawForColumns,
        "column",
      );
    }

    // Sentinel rows — keep a marker row so the column profile / API detail page
    // can show "unsupported" / "derived" in the lineage section. column_name is
    // the sentinel tag so it's still queryable, table_name null.
    if (ann.sentinel) {
      insertColumn.run(
        `(${ann.sentinel})`,
        null,
        specSource ?? null,
        apiId,
        ann.fieldPath,
        rawForColumns,
        ann.sentinel,
      );
    }

    // Lineage edges from x-lineageLookupReferenceObject. Use the spec's context
    // to correct the heuristic guess: ethos/EEDM specs point at API resources,
    // non-ethos ones at DB tables.
    if (ann.lookupReference) {
      const kind: string =
        isEthosSpec ? "api-resource" :
        ann.lookupGuessedKind ?? "db-table";
      insertLineageEdge.run(apiId, kind, ann.lookupReference, ann.fieldPath);
    }
  }

  for (const file of files) {
    stats.processed += 1;
    familySet.add(file.family);

    const existing = selectFile.get(file.path);
    const unchanged =
      existing !== null &&
      existing.mtime === file.mtimeMs &&
      existing.size === file.size &&
      existing.parse_status === "ok";

    if (unchanged) {
      stats.skipped += 1;
      touchFile.run(Date.now(), file.path);
    } else {
      const parsed = await parseSpec(file.path);
      const { outcome } = applyParsed(file, parsed);
      if (outcome === "ok") stats.inserted += 1;
      else stats.errors += 1;
    }

    if (opts.onProgress && (stats.processed % 50 === 0 || stats.processed === stats.total)) {
      stats.durationMs = Date.now() - start;
      stats.currentFile = file.path;
      opts.onProgress({ ...stats });
    }
  }

  // Stale cleanup: anything in the files table whose last_indexed is older
  // than the start of this scan wasn't encountered on disk — it's gone.
  // Remove those rows; cascading deletes handle apis → endpoints → columns →
  // lineage_edges.
  const removedFiles = db
    .query<{ path: string }, [number]>(`SELECT path FROM files WHERE last_indexed < ?`)
    .all(scanStartedAt);

  if (removedFiles.length > 0) {
    const wipe = db.transaction(() => {
      db.query(`DELETE FROM apis WHERE file_path IN (SELECT path FROM files WHERE last_indexed < ?)`).run(scanStartedAt);
      db.query(`DELETE FROM files WHERE last_indexed < ?`).run(scanStartedAt);
    });
    wipe();
    stats.removed = removedFiles.length;
  }

  // WAL checkpoint so the on-disk file stays trim after big scans. PASSIVE
  // is non-blocking (only checkpoints what it can without contention).
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");

  stats.durationMs = Date.now() - start;
  stats.familiesSeen = [...familySet].sort();
  return stats;
}

/**
 * Wipe the entire index — used by the Settings → "Clear index" action.
 *
 * We delete the SQLite file (plus its -shm / -wal companions) rather than running
 * DELETE+VACUUM. VACUUM in WAL mode frequently fails to shrink the on-disk file
 * (it marks pages free internally but won't return them to the OS), so the
 * 46 MB index stays 46 MB after a logical clear. Deleting the file and letting
 * `openIndex()` recreate it from the migration is cleaner and the file starts at
 * a few KB again.
 *
 * The caller is expected to close the cached DB handle before calling this and
 * to re-open via `openIndex()` afterwards.
 */
export async function clearIndexFiles(currentDb: Database): Promise<{ apis: number; files: number; paths: string[] }> {
  const apis = currentDb.query<{ c: number }, []>(`SELECT count(*) as c FROM apis`).get()?.c ?? 0;
  const files = currentDb.query<{ c: number }, []>(`SELECT count(*) as c FROM files`).get()?.c ?? 0;

  const dbFilename = currentDb.filename;
  currentDb.close();

  const paths: string[] = [];
  for (const suffix of ["", "-shm", "-wal", "-journal"]) {
    const target = dbFilename + suffix;
    try {
      await unlink(target);
      paths.push(target);
    } catch {
      // file not present — fine
    }
  }
  return { apis, files, paths };
}
