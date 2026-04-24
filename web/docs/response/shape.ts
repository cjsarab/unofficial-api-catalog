// web/docs/response/shape.ts
//
// Pure decomposition: parsed JSON → ordered list of flat peer tables.
// See docs/superpowers/specs/2026-04-24-response-panel-design.md for the contract.

import type {
  CellValue,
  Column,
  ColumnKind,
  DecomposedTable,
  Json,
  Row,
} from "./types.ts";

// --- classification helpers -------------------------------------------------

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

// --- column builder ---------------------------------------------------------
//
// Columns are kept in insertion order during the walk, then reordered on
// finalize() so synthetic columns lead and the rest are alphabetical.
// Required because the union of keys across heterogeneous rows is data-driven.

function makeColumnBuilder() {
  const map = new Map<string, Column>();
  return {
    ensure(key: string, kind: ColumnKind, synthNote?: string) {
      if (!map.has(key)) map.set(key, { key, kind, synthNote });
    },
    finalize(): Column[] {
      const synthetic: Column[] = [];
      const rest: Column[] = [];
      for (const col of map.values()) {
        if (col.kind === "synthetic") synthetic.push(col);
        else rest.push(col);
      }
      rest.sort((a, b) => a.key.localeCompare(b.key));
      // _parent_id / _parent_idx leads, then _idx, then the rest.
      synthetic.sort((a, b) => {
        const score = (k: string) =>
          k === "_parent_id" || k === "_parent_idx" ? 0 : k === "_idx" ? 1 : 2;
        return score(a.key) - score(b.key);
      });
      return [...synthetic, ...rest];
    },
  };
}

// --- main entry point -------------------------------------------------------

export function decompose(root: Json): DecomposedTable[] {
  if (isScalar(root)) return [];

  const tables: DecomposedTable[] = [];
  emitTableFor(root, "$", null, "root", 0, null, tables);
  return tables;
}

// --- core recursion ---------------------------------------------------------

function emitTableFor(
  node: Json,
  path: string,
  parentPath: string | null,
  label: string,
  depth: number,
  parentRowId: string | number | null,
  tables: DecomposedTable[],
): void {
  const rows: Row[] = [];
  const cols = makeColumnBuilder();

  const parentIdKey = parentPath !== null
    ? (typeof parentRowId === "number" ? "_parent_idx" : "_parent_id")
    : null;

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
    node.forEach((item, i) => {
      rowFor(item, `${path}[${i}]`, i, rows, cols, parentIdKey, parentRowId, path, tables, depth);
    });
  } else if (isObject(node) && Object.keys(node).length > 0) {
    rowFor(node, path, 0, rows, cols, parentIdKey, parentRowId, path, tables, depth);
  }

  tables.push({
    path,
    parentPath,
    label,
    depth,
    rows,
    columns: cols.finalize(),
  });
}

function rowFor(
  item: Json,
  _itemPath: string,
  idx: number,
  rows: Row[],
  cols: ReturnType<typeof makeColumnBuilder>,
  parentIdKey: string | null,
  parentRowId: string | number | null,
  _currentTablePath: string,
  _tables: DecomposedTable[],
  _depth: number,
): void {
  const row: Row = {};

  if (isScalar(item)) {
    cols.ensure("value", "scalar");
    row["value"] = { kind: "scalar", value: item };
  } else if (isObject(item)) {
    for (const [k, v] of Object.entries(item)) {
      if (isScalar(v)) {
        cols.ensure(k, "scalar");
        row[k] = { kind: "scalar", value: v } satisfies CellValue;
      }
      // other kinds handled in later task
    }
  }

  if (parentIdKey) {
    row[parentIdKey] = { kind: "scalar", value: parentRowId } satisfies CellValue;
  }

  rows.push(row);
}
