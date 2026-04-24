// Sort comparator for scalar cell values.
//
// Rules:
//  - `undefined` (missing cell) and scalar `null` always sort to the END,
//    regardless of direction — they represent absent data.
//  - numbers compare numerically.
//  - booleans: `false < true`.
//  - strings: `localeCompare` (case-insensitive default).
//  - mixed types: fall back to `String(a).localeCompare(String(b))`.
//
// Kept in its own file so the comparator is unit-testable without booting a DOM.

import type { CellValue } from "./types.ts";

type ScalarValue = string | number | boolean | null;

function scalarOrNull(cell: CellValue | undefined): ScalarValue | typeof ABSENT {
  if (cell === undefined) return ABSENT;
  if (cell.kind !== "scalar") return ABSENT;
  if (cell.value === null) return ABSENT;
  return cell.value;
}

const ABSENT = Symbol("absent");

export function compareCells(
  a: CellValue | undefined,
  b: CellValue | undefined,
  dir: "asc" | "desc",
): number {
  const av = scalarOrNull(a);
  const bv = scalarOrNull(b);

  // Nulls / absent always go to the END regardless of dir.
  if (av === ABSENT && bv === ABSENT) return 0;
  if (av === ABSENT) return 1;
  if (bv === ABSENT) return -1;

  const sign = dir === "asc" ? 1 : -1;

  if (typeof av === "number" && typeof bv === "number") {
    return sign * (av - bv);
  }
  if (typeof av === "boolean" && typeof bv === "boolean") {
    // false < true
    return sign * ((av === bv) ? 0 : av ? 1 : -1);
  }
  if (typeof av === "string" && typeof bv === "string") {
    return sign * av.localeCompare(bv, undefined, { sensitivity: "base" });
  }
  // Mixed types — stringify and compare.
  return sign * String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
}
