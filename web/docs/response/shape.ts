// web/docs/response/shape.ts
//
// Pure decomposition: parsed JSON → ordered list of flat peer tables.
// Contract lives in docs/superpowers/specs/2026-04-24-response-panel-design.md.

import type {
  CellValue,
  Column,
  ColumnKind,
  DecomposedTable,
  Json,
  Row,
} from "./types.ts";

// --- classification ---------------------------------------------------------

export function isScalar(v: Json): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function isObject(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: Json): v is Json[] {
  return Array.isArray(v);
}

function isArrayOfObjects(v: Json): boolean {
  return isArray(v) && v.length > 0 && v.every(isObject);
}

function isArrayOfArrays(v: Json): boolean {
  return isArray(v) && v.length > 0 && v.every((e) => isArray(e));
}

type ItemKind = "obj" | "arr" | "scalar";
function itemKind(v: Json): ItemKind {
  if (isArray(v)) return "arr";
  if (isObject(v)) return "obj";
  return "scalar";
}

// --- path helpers -----------------------------------------------------------

function escapeKey(k: string): string {
  return k.includes(".") || k.includes("[") || k.includes("]") ? `["${k}"]` : k;
}

// --- column builder ---------------------------------------------------------

const MAX_COLUMNS = 20;

function makeColumnBuilder() {
  const map = new Map<string, Column>();
  return {
    ensure(key: string, kind: ColumnKind, synthNote?: string) {
      if (!map.has(key)) map.set(key, { key, kind, synthNote });
    },
    finalize(): { columns: Column[]; hiddenColumnCount?: number } {
      const synthetic: Column[] = [];
      const rest: Column[] = [];
      for (const col of map.values()) {
        if (col.kind === "synthetic") synthetic.push(col);
        else rest.push(col);
      }
      rest.sort((a, b) => a.key.localeCompare(b.key));
      synthetic.sort((a, b) => {
        const score = (k: string) =>
          k === "_parent_id" || k === "_parent_idx" ? 0 : k === "_idx" ? 1 : 2;
        return score(a.key) - score(b.key);
      });
      const all = [...synthetic, ...rest];
      if (all.length <= MAX_COLUMNS) return { columns: all };
      return {
        columns: all.slice(0, MAX_COLUMNS),
        hiddenColumnCount: all.length - MAX_COLUMNS,
      };
    },
  };
}

// --- parent-id resolution ---------------------------------------------------

const ID_PRIORITY = ["id", "guid", "code", "key"] as const;

function parentScalarIdOf(obj: { [k: string]: Json }): string | number | null {
  for (const k of ID_PRIORITY) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    if (/(?:Id|Code)$/.test(k)) return v;
  }
  return null;
}

// --- label helper -----------------------------------------------------------

function labelFor(path: string, fallback = "root"): string {
  if (path === "$") return fallback;
  const tail = path.replace(/^\$\.?/, "").replace(/\["([^"]+)"\]$/, "$1");
  const parts = tail.split(".");
  const last = parts[parts.length - 1] || fallback;
  return last || fallback;
}

// --- wrapper collapse -------------------------------------------------------

function collapseWrapper(root: Json): [Json, string] {
  if (!isObject(root)) return [root, "$"];
  const keys = Object.keys(root);
  if (keys.length !== 1) return [root, "$"];
  const only = keys[0]!;
  const value = root[only];
  if (value === undefined || !isArrayOfObjects(value)) return [root, "$"];
  return [value, `$.${escapeKey(only)}`];
}

// --- main entry -------------------------------------------------------------

export function decompose(root: Json): DecomposedTable[] {
  if (isScalar(root)) return [];

  const tables: DecomposedTable[] = [];
  const [effectiveRoot, rootPath] = collapseWrapper(root);
  emitTable(effectiveRoot, rootPath, null, labelFor(rootPath), 0, null, tables, undefined);
  return tables;
}

// --- pending-peer emission descriptor ---------------------------------------
//
// For an array-of-objects (or array-of-arrays) field encountered inside a row,
// we build rows eagerly (so the primary table emits in pre-order), and queue
// a peer emission to be flushed AFTER the primary table is pushed.

interface PendingPeer {
  path: string;                   // e.g. "$[*].children"
  parentPath: string;             // primary's path
  label: string;
  depth: number;
  rows: Row[];                    // already flattened rows (one per child item)
  cols: ReturnType<typeof makeColumnBuilder>;
  nestedPeers: PendingPeer[];     // deeper peers collected during child flattening
  rangeNote?: string;
  // Per-child provenance for the synthetic parent-id column. We defer the
  // column's name/values until finalize so we can degrade uniformly to
  // "_parent_idx" when any contributing parent lacks a scalar id.
  parentIds?: (string | number | null)[];
  parentIdxs?: number[];
  anyParentLackedScalarId?: boolean;
}

function flushPeer(peer: PendingPeer, tables: DecomposedTable[]): void {
  // Reconcile the synthetic parent-id column across all contributing parents.
  if (peer.parentIds && peer.parentIdxs && peer.rows.length > 0) {
    const useIdx = peer.anyParentLackedScalarId === true;
    const key = useIdx ? "_parent_idx" : "_parent_id";
    peer.cols.ensure(
      key,
      "synthetic",
      useIdx ? "Row index of parent — no scalar id found" : undefined,
    );
    peer.rows.forEach((row, i) => {
      const value = useIdx ? peer.parentIdxs![i]! : peer.parentIds![i]!;
      row[key] = { kind: "scalar", value };
    });
  }

  const finalised = peer.cols.finalize();
  tables.push({
    path: peer.path,
    parentPath: peer.parentPath,
    label: peer.label,
    depth: peer.depth,
    rows: peer.rows,
    columns: finalised.columns,
    hiddenColumnCount: finalised.hiddenColumnCount,
    rangeNote: peer.rangeNote,
  });
  for (const nested of peer.nestedPeers) flushPeer(nested, tables);
}

// --- core: emitTable --------------------------------------------------------

function emitTable(
  node: Json,
  path: string,
  parentPath: string | null,
  label: string,
  depth: number,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
  rangeNote: string | undefined,
  suppressParentId: boolean = false,
): void {
  const rows: Row[] = [];
  const cols = makeColumnBuilder();
  const pendingPeers: PendingPeer[] = [];

  const parentIdKey: string | null =
    parentPath === null || suppressParentId
      ? null
      : typeof parentRowId === "number"
        ? "_parent_idx"
        : "_parent_id";

  if (parentIdKey) {
    cols.ensure(
      parentIdKey,
      "synthetic",
      parentIdKey === "_parent_idx"
        ? "Row index of parent — no scalar id found"
        : undefined,
    );
  }

  if (isArray(node)) {
    if (node.length > 0) {
      const runs = contiguousRuns(node);
      if (runs.length > 1) {
        // Heterogeneous: emit primary (empty) then peers, one per run.
        const finalised = cols.finalize();
        tables.push({
          path,
          parentPath,
          label,
          depth,
          rows: [],
          columns: finalised.columns,
          hiddenColumnCount: finalised.hiddenColumnCount,
          rangeNote,
        });
        for (const run of runs) {
          const runRange = run.from === run.to ? `[${run.from}]` : `[${run.from}..${run.to}]`;
          const runPath = `${path}${runRange}`;
          const runLabel = labelFor(runPath, runRange);
          // Heterogeneous-run peers have no rows on their parent to join to —
          // suppress the synthetic parent-id column entirely.
          emitRun(run, runPath, path, runLabel, depth + 1, parentRowId, tables, runRange, true);
        }
        return;
      }

      // Homogeneous run.
      const kind = itemKind(node[0]!);
      if (kind === "obj") {
        node.forEach((item, i) => {
          const row = buildObjectRow(
            item as { [k: string]: Json },
            cols,
            parentIdKey,
            parentRowId,
            `${path}[${i}]`,
            i,
            depth,
            pendingPeers,
            path,             // parent path for peer emissions
            true,             // inside array (use "$[*].field" for peer path)
          );
          rows.push(row);
        });
      } else if (kind === "arr") {
        // Array of arrays: each inner array → its own peer table.
        node.forEach((inner, i) => {
          if (!isArray(inner)) return;
          const childPath = `${path}[${i}]`;
          const childLabel = `[${i}]`;
          const peer = buildPeerTableForArray(inner, childPath, path, childLabel, depth + 1, i);
          pendingPeers.push(peer);
          cols.ensure("_idx", "synthetic");
          cols.ensure(childLabel, "count-link");
          const row: Row = {
            _idx: { kind: "scalar", value: i },
            [childLabel]: { kind: "count-link", count: inner.length, targetTablePath: childPath, parentRowId: i },
          };
          if (parentIdKey) row[parentIdKey] = { kind: "scalar", value: parentRowId };
          rows.push(row);
        });
      } else {
        // Array of scalars.
        node.forEach((item) => {
          cols.ensure("value", "scalar");
          const row: Row = { value: { kind: "scalar", value: item as string | number | boolean | null } };
          if (parentIdKey) row[parentIdKey] = { kind: "scalar", value: parentRowId };
          rows.push(row);
        });
      }
    }
  } else if (isObject(node)) {
    if (Object.keys(node).length > 0) {
      const row = buildObjectRow(
        node,
        cols,
        parentIdKey,
        parentRowId,
        path,
        0,
        depth,
        pendingPeers,
        path,
        false,
      );
      rows.push(row);
    }
  }

  const finalised = cols.finalize();
  tables.push({
    path,
    parentPath,
    label,
    depth,
    rows,
    columns: finalised.columns,
    hiddenColumnCount: finalised.hiddenColumnCount,
    rangeNote,
  });

  for (const peer of pendingPeers) flushPeer(peer, tables);
}

// --- heterogeneous run handling --------------------------------------------

function emitRun(
  run: Run,
  runPath: string,
  parentPath: string,
  label: string,
  depth: number,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
  rangeNote: string,
  suppressParentId: boolean = false,
): void {
  const kind = run.items.length > 0 ? itemKind(run.items[0]!) : "scalar";
  if (kind === "arr" && run.items.length === 1 && isArray(run.items[0]!)) {
    // Unwrap: the single inner array is this table's content.
    emitTable(run.items[0]!, runPath, parentPath, label, depth, parentRowId, tables, rangeNote, suppressParentId);
  } else {
    // Pass the run.items as an array to emitTable; it will treat them per kind.
    emitTable(run.items, runPath, parentPath, label, depth, parentRowId, tables, rangeNote, suppressParentId);
  }
}

// --- build a row for an object ---------------------------------------------

function buildObjectRow(
  obj: { [k: string]: Json },
  cols: ReturnType<typeof makeColumnBuilder>,
  parentIdKey: string | null,
  parentRowId: string | number | null,
  thisRowPath: string,
  idx: number,
  depth: number,
  pendingPeers: PendingPeer[],
  parentTablePath: string,
  insideArray: boolean,
): Row {
  const row: Row = {};
  const parentScalarId = parentScalarIdOf(obj);
  // Pass-through parent: object whose every value is an array (after flattening, the row will
  // consist entirely of count-links). We detect up-front because peer paths depend on it.
  const isPassThroughParent =
    Object.keys(obj).length > 0 &&
    Object.values(obj).every((v) => isArray(v));

  flattenInto(
    obj,
    "",
    row,
    cols,
    thisRowPath,
    depth,
    0,
    parentTablePath,
    pendingPeers,
    parentScalarId,
    idx,
    insideArray,
    isPassThroughParent,
  );

  // Pass-through: object with ONLY count-link columns → synthesise _idx.
  const hasAny = Object.keys(row).length > 0;
  const allCountLinks =
    hasAny &&
    Object.values(row).every((c) => (c as CellValue).kind === "count-link");
  if (allCountLinks) {
    cols.ensure("_idx", "synthetic");
    row["_idx"] = { kind: "scalar", value: idx };
  }

  if (parentIdKey) {
    row[parentIdKey] = { kind: "scalar", value: parentRowId };
  }

  return row;
}

// --- flatten one object into a row + queue peer emissions ------------------

function flattenInto(
  obj: { [k: string]: Json },
  prefix: string,
  row: Row,
  cols: ReturnType<typeof makeColumnBuilder>,
  thisRowPath: string,
  treeDepth: number,
  flattenDepth: number,
  chipParentPath: string,
  pendingPeers: PendingPeer[],
  parentScalarId: string | number | null,
  rowIdx: number,
  insideArray: boolean,
  isPassThroughParent: boolean,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const safeKey = escapeKey(k);
    const col = prefix ? `${prefix}.${safeKey}` : safeKey;

    if (isScalar(v)) {
      cols.ensure(col, prefix ? "dotted" : "scalar");
      row[col] = { kind: "scalar", value: v };
    } else if (isObject(v)) {
      if (flattenDepth < 2) {
        flattenInto(
          v,
          col,
          row,
          cols,
          thisRowPath,
          treeDepth,
          flattenDepth + 1,
          chipParentPath,
          pendingPeers,
          parentScalarId,
          rowIdx,
          insideArray,
          isPassThroughParent,
        );
      } else {
        cols.ensure(col, "nested-chip");
        row[col] = {
          kind: "chip-object",
          keyCount: Object.keys(v).length,
          jumpPath: `${thisRowPath}.${col}`,
        };
      }
    } else if (isArray(v)) {
      if (isArrayOfObjects(v) || isArrayOfArrays(v)) {
        // Peer-table emission.
        // Peer path: if this row is inside an outer array AND is not a pass-through wrapper,
        // aggregate peers across all parent rows using "[*]". Otherwise (root object or
        // pass-through row with only array fields), use the concrete index.
        const peerPath = insideArray && !isPassThroughParent
          ? `${rootStripIndex(thisRowPath)}.${col}`   // e.g. "$[*].children"
          : `${thisRowPath}.${col}`;                  // e.g. "$.data" or "$[0].academicLevels"
        cols.ensure(col, "count-link");
        row[col] = {
          kind: "count-link",
          count: v.length,
          // Must match the aggregated peer's emitted path — wildcard for
          // non-pass-through parents inside an outer array, concrete otherwise.
          targetTablePath: peerPath,
          parentRowId: parentScalarId !== null ? parentScalarId : rowIdx,
        };

        // Build (or extend) the peer. We keep ONE peer per peerPath to aggregate.
        const existing = pendingPeers.find((p) => p.path === peerPath);
        const peer = existing ?? newPeer(peerPath, thisRowPath, col, treeDepth + 1);
        if (!existing) pendingPeers.push(peer);

        appendChildrenToPeer(
          peer,
          v,
          parentScalarId,
          rowIdx,
          treeDepth + 1,
        );
      } else {
        cols.ensure(col, "nested-chip");
        row[col] = {
          kind: "chip-array",
          count: v.length,
          jumpPath: `${thisRowPath}.${col}`,
        };
      }
    }
  }
}

// Replace "[<n>]" at the end with "[*]" to convert a concrete row path into a wildcard base.
// "$[0]" → "$[*]"; "$[*].terms[0]" → "$[*].terms[*]"; "$" → "$"
function rootStripIndex(rowPath: string): string {
  return rowPath.replace(/\[\d+\]$/, "[*]");
}

function newPeer(
  path: string,
  parentPath: string,
  label: string,
  depth: number,
): PendingPeer {
  const cols = makeColumnBuilder();
  return {
    path,
    parentPath,
    label,
    depth,
    rows: [],
    cols,
    nestedPeers: [],
    parentIds: [],
    parentIdxs: [],
    anyParentLackedScalarId: false,
  };
}

function appendChildrenToPeer(
  peer: PendingPeer,
  children: Json[],
  parentScalarId: string | number | null,
  parentRowIdx: number,
  depth: number,
): void {
  // Track whether this contributing parent had a scalar id. The final peer
  // column name (and values) is decided at flushPeer time: if ANY contributor
  // lacked an id, the entire peer degrades to "_parent_idx" uniformly.
  if (parentScalarId === null) peer.anyParentLackedScalarId = true;

  const recordProvenance = () => {
    peer.parentIds!.push(parentScalarId);
    peer.parentIdxs!.push(parentRowIdx);
  };

  children.forEach((child, i) => {
    if (isObject(child)) {
      const childScalarId = parentScalarIdOf(child);
      const childIsPassThrough =
        Object.keys(child).length > 0 &&
        Object.values(child).every((v) => isArray(v));
      const childRow: Row = {};
      flattenInto(
        child,
        "",
        childRow,
        peer.cols,
        `${peer.path}[${i}]`,
        depth,
        0,
        peer.path,
        peer.nestedPeers,
        childScalarId,
        i,
        true,
        childIsPassThrough,
      );
      // Pass-through inside peer too.
      const hasAny = Object.keys(childRow).length > 0;
      const allCountLinks =
        hasAny &&
        Object.values(childRow).every((c) => (c as CellValue).kind === "count-link");
      if (allCountLinks) {
        peer.cols.ensure("_idx", "synthetic");
        childRow["_idx"] = { kind: "scalar", value: i };
      }
      peer.rows.push(childRow);
      recordProvenance();
    } else if (isArray(child)) {
      // Array-of-arrays peer: each inner array → one row with count-link.
      peer.cols.ensure("_idx", "synthetic");
      const label = `[${i}]`;
      peer.cols.ensure(label, "count-link");
      const grandchildPath = `${peer.path}[${i}]`;
      // Emit a deeper peer for the inner array itself.
      const inner = buildPeerTableForArray(child, grandchildPath, peer.path, label, depth + 1, i);
      peer.nestedPeers.push(inner);
      const childRow: Row = {
        _idx: { kind: "scalar", value: i },
        [label]: { kind: "count-link", count: child.length, targetTablePath: grandchildPath, parentRowId: i },
      };
      peer.rows.push(childRow);
      recordProvenance();
    }
  });
}

// Build a peer table for a single inner array's contents (used by array-of-arrays at root).
function buildPeerTableForArray(
  arr: Json[],
  path: string,
  parentPath: string,
  label: string,
  depth: number,
  parentIdxValue: number,
): PendingPeer {
  const peer = newPeer(path, parentPath, label, depth);
  // Array-of-arrays peers own their synthetic column directly (single parent
  // contributor, always index-based). Opt out of deferred reconciliation.
  peer.parentIds = undefined;
  peer.parentIdxs = undefined;
  const parentIdKey = "_parent_idx";
  peer.cols.ensure(parentIdKey, "synthetic", "Row index of parent — no scalar id found");

  arr.forEach((item, i) => {
    if (isObject(item)) {
      const childScalarId = parentScalarIdOf(item);
      const childIsPassThrough =
        Object.keys(item).length > 0 &&
        Object.values(item).every((v) => isArray(v));
      const childRow: Row = {};
      flattenInto(
        item,
        "",
        childRow,
        peer.cols,
        `${peer.path}[${i}]`,
        depth,
        0,
        peer.path,
        peer.nestedPeers,
        childScalarId,
        i,
        true,
        childIsPassThrough,
      );
      childRow[parentIdKey] = { kind: "scalar", value: parentIdxValue };
      peer.rows.push(childRow);
    } else if (isScalar(item)) {
      peer.cols.ensure("value", "scalar");
      const childRow: Row = {
        value: { kind: "scalar", value: item },
      };
      childRow[parentIdKey] = { kind: "scalar", value: parentIdxValue };
      peer.rows.push(childRow);
    } else if (isArray(item)) {
      // Nested further; recurse.
      const sub = buildPeerTableForArray(item, `${peer.path}[${i}]`, peer.path, `[${i}]`, depth + 1, i);
      peer.nestedPeers.push(sub);
      peer.cols.ensure("_idx", "synthetic");
      const lbl = `[${i}]`;
      peer.cols.ensure(lbl, "count-link");
      const childRow: Row = {
        _idx: { kind: "scalar", value: i },
        [lbl]: { kind: "count-link", count: item.length, targetTablePath: `${peer.path}[${i}]`, parentRowId: i },
      };
      childRow[parentIdKey] = { kind: "scalar", value: parentIdxValue };
      peer.rows.push(childRow);
    }
  });
  return peer;
}

// --- heterogeneous-array run splitting --------------------------------------

interface Run {
  from: number;
  to: number;
  items: Json[];
}

function contiguousRuns(arr: Json[]): Run[] {
  if (arr.length === 0) return [{ from: 0, to: -1, items: [] }];
  const firstKind = itemKind(arr[0]!);
  const allSame = arr.every((v) => itemKind(v) === firstKind);
  if (allSame) return [{ from: 0, to: arr.length - 1, items: arr }];

  const runs: Run[] = [];
  let start = 0;
  let currentKind = itemKind(arr[0]!);
  for (let i = 1; i < arr.length; i++) {
    const k = itemKind(arr[i]!);
    if (k !== currentKind) {
      runs.push({ from: start, to: i - 1, items: arr.slice(start, i) });
      start = i;
      currentKind = k;
    }
  }
  runs.push({ from: start, to: arr.length - 1, items: arr.slice(start) });
  return runs;
}
