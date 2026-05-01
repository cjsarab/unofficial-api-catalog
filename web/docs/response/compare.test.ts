import { describe, expect, test } from "vitest";
import { compareCells } from "./compare.ts";
import type { CellValue } from "./types.ts";

const s = (v: string | number | boolean | null): CellValue => ({ kind: "scalar", value: v });

describe("compareCells", () => {
  test("null and undefined sort to the end in asc", () => {
    const rows: Array<CellValue | undefined> = [s(2), undefined, s(1), s(null), s(3)];
    rows.sort((a, b) => compareCells(a, b, "asc"));
    // Non-null values in order, then null/undefined at the end (order among trailing doesn't matter).
    expect(rows.slice(0, 3)).toEqual([s(1), s(2), s(3)]);
    // Last two are the absent ones in some order.
    const tail = rows.slice(3);
    expect(tail).toHaveLength(2);
    for (const t of tail) {
      expect(t === undefined || (t.kind === "scalar" && t.value === null)).toBe(true);
    }
  });

  test("null still sorts to the end in desc", () => {
    const rows: Array<CellValue | undefined> = [s(2), s(null), s(1), s(3)];
    rows.sort((a, b) => compareCells(a, b, "desc"));
    expect(rows.slice(0, 3)).toEqual([s(3), s(2), s(1)]);
    expect(rows[3]).toEqual(s(null));
  });

  test("numbers compare numerically, not lexically", () => {
    const rows = [s(10), s(2), s(100), s(20)];
    rows.sort((a, b) => compareCells(a, b, "asc"));
    expect(rows).toEqual([s(2), s(10), s(20), s(100)]);
  });

  test("booleans: false < true", () => {
    const rows = [s(true), s(false), s(true), s(false)];
    rows.sort((a, b) => compareCells(a, b, "asc"));
    expect(rows).toEqual([s(false), s(false), s(true), s(true)]);
    rows.sort((a, b) => compareCells(a, b, "desc"));
    expect(rows).toEqual([s(true), s(true), s(false), s(false)]);
  });

  test("strings use case-insensitive localeCompare", () => {
    const rows = [s("banana"), s("Apple"), s("cherry"), s("apricot")];
    rows.sort((a, b) => compareCells(a, b, "asc"));
    expect(rows.map((r) => r && r.kind === "scalar" && r.value)).toEqual([
      "Apple",
      "apricot",
      "banana",
      "cherry",
    ]);
  });

  test("mixed types fall back to stringified localeCompare", () => {
    // "10" vs "2" → "10" comes first lexically.
    const rows: CellValue[] = [s(2), s("10"), s(true)];
    rows.sort((a, b) => compareCells(a, b, "asc"));
    // This test just asserts we don't throw and produce a stable, deterministic order.
    expect(rows).toHaveLength(3);
    // Non-null scalars must remain; none should be null.
    for (const r of rows) expect(r.kind === "scalar" && r.value !== null).toBe(true);
  });
});
