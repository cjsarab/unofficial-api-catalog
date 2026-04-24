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
