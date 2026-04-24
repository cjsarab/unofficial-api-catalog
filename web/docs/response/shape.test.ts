import { describe, expect, test } from "bun:test";
import { decompose } from "./shape.ts";
import type { DecomposedTable } from "./types.ts";

function paths(tables: DecomposedTable[]): string[] {
  return tables.map((t) => t.path);
}

describe("shape.decompose — basics", () => {
  test("scalar_root", () => {
    expect(decompose("hello")).toEqual([]);
    expect(decompose(42 as never)).toEqual([]);
    expect(decompose(true as never)).toEqual([]);
  });

  test("null_root", () => {
    expect(decompose(null)).toEqual([]);
  });

  test("empty_array", () => {
    const tables = decompose([]);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.path).toBe("$");
    expect(tables[0]!.rows).toEqual([]);
    expect(tables[0]!.columns).toEqual([]);
  });

  test("empty_object", () => {
    const tables = decompose({});
    expect(tables).toHaveLength(1);
    expect(tables[0]!.path).toBe("$");
    expect(tables[0]!.rows).toEqual([]);
    expect(tables[0]!.columns).toEqual([]);
  });

  test("array_of_scalars", () => {
    const tables = decompose([1, 2, "three"]);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.path).toBe("$");
    expect(tables[0]!.columns.map((c) => c.key)).toEqual(["value"]);
    expect(tables[0]!.rows).toHaveLength(3);
    expect(tables[0]!.rows[0]!["value"]).toEqual({ kind: "scalar", value: 1 });
    expect(tables[0]!.rows[2]!["value"]).toEqual({ kind: "scalar", value: "three" });
  });

  test("array_of_objects_simple", () => {
    const tables = decompose([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ]);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.columns.map((c) => c.key)).toEqual(["id", "name"]);
    expect(tables[0]!.rows[0]!["name"]).toEqual({ kind: "scalar", value: "Alice" });
  });

  test("object_with_only_scalars yields a single-row KV table", () => {
    const tables = decompose({ id: "a", code: "CS", active: true });
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(1);
    expect(tables[0]!.columns.map((c) => c.key)).toEqual(["active", "code", "id"]); // alphabetical
    expect(tables[0]!.rows[0]!["id"]).toEqual({ kind: "scalar", value: "a" });
  });
});

describe("shape.decompose — flatten + chips", () => {
  test("dotted_flatten_depth_3: 3-deep object flattens, 4th level chips", () => {
    const tables = decompose([
      { a: { b: { c: { d: "deep" } } } },
    ]);
    const cols = tables[0]!.columns.map((c) => c.key);
    // a.b.c is the terminal column (flatten depth 3 = a -> a.b -> a.b.c). The 'd' key lives under c, past the budget.
    expect(cols).toEqual(["a.b.c"]);
    // Cell is a chip-object pointing at the remaining object { d: "deep" }.
    const cell = tables[0]!.rows[0]!["a.b.c"]!;
    expect(cell.kind).toBe("chip-object");
    if (cell.kind === "chip-object") {
      expect(cell.keyCount).toBe(1);
      expect(cell.jumpPath).toBe("$[0].a.b.c");
    }
  });

  test("dotted_flatten: 2-deep object produces flat scalar columns (no chip)", () => {
    const tables = decompose([
      { outer: { inner: "X", deeper: 42 } },
    ]);
    const cols = tables[0]!.columns.map((c) => c.key);
    expect(cols).toEqual(["outer.deeper", "outer.inner"]);
    expect(tables[0]!.rows[0]!["outer.inner"]).toEqual({ kind: "scalar", value: "X" });
    expect(tables[0]!.rows[0]!["outer.deeper"]).toEqual({ kind: "scalar", value: 42 });
    expect(tables[0]!.columns.find((c) => c.key === "outer.inner")?.kind).toBe("dotted");
  });

  test("array_of_scalars_field becomes a chip-array in the row", () => {
    const tables = decompose([
      { id: "a", tags: ["red", "blue"] },
    ]);
    // Only one table — tags is scalars, stays in-row as chip-array.
    expect(tables).toHaveLength(1);
    const cell = tables[0]!.rows[0]!["tags"]!;
    expect(cell.kind).toBe("chip-array");
    if (cell.kind === "chip-array") {
      expect(cell.count).toBe(2);
      expect(cell.jumpPath).toBe("$[0].tags");
    }
  });

  test("mixed_type_array_field is rendered as a chip-array", () => {
    const tables = decompose([
      { id: "a", mixed: [1, "two", { x: 3 }] },
    ]);
    expect(tables).toHaveLength(1); // mixed arrays don't become peer tables in this task
    const cell = tables[0]!.rows[0]!["mixed"]!;
    expect(cell.kind).toBe("chip-array");
  });
});
