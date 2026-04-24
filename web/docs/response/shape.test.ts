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

describe("shape.decompose — peer tables + edge cases", () => {
  test("nested_one_level: object has array-of-objects field → peer table", () => {
    const tables = decompose([
      { id: "A", children: [{ n: 1 }, { n: 2 }] },
    ]);
    expect(paths(tables)).toEqual(["$", "$[*].children"]);
    // Parent table: id column + count-link to children.
    const parent = tables[0]!;
    expect(parent.columns.map((c) => c.key).sort()).toEqual(["children", "id"]);
    expect(parent.rows[0]!["children"]).toEqual({
      kind: "count-link",
      count: 2,
      targetTablePath: "$[0].children",
    });
    // Peer: _parent_id = "A" (from scalar id) + n column.
    const peer = tables[1]!;
    expect(peer.columns.map((c) => c.key)).toEqual(["_parent_id", "n"]);
    expect(peer.rows[0]!["_parent_id"]).toEqual({ kind: "scalar", value: "A" });
    expect(peer.rows[0]!["n"]).toEqual({ kind: "scalar", value: 1 });
    expect(peer.depth).toBe(1);
  });

  test("_parent_idx fallback when parent has no scalar id", () => {
    const tables = decompose([
      { values: [{ n: 1 }] },
    ]);
    const peer = tables[1]!;
    // No id/guid/code/key on parent → synthesised _parent_idx.
    expect(peer.columns.map((c) => c.key)).toEqual(["_parent_idx", "n"]);
    expect(peer.rows[0]!["_parent_idx"]).toEqual({ kind: "scalar", value: 0 });
    expect(peer.columns[0]!.synthNote).toBe("Row index of parent — no scalar id found");
  });

  test("parent_id_priority: id beats guid beats code beats key", () => {
    const tables = decompose([
      { guid: "G", code: "C", key: "K", id: "ID", items: [{ x: 1 }] },
    ]);
    expect(tables[1]!.rows[0]!["_parent_id"]).toEqual({ kind: "scalar", value: "ID" });
  });

  test("object_collapses_wrapper: { data: [arrayOfObjects] } → single promoted table", () => {
    const tables = decompose({ data: [{ id: "a" }, { id: "b" }] });
    expect(tables).toHaveLength(1);
    expect(tables[0]!.path).toBe("$.data");
    expect(tables[0]!.rows).toHaveLength(2);
  });

  test("object_no_collapse_wrapper: { data: [...], meta: {...} } stays as primary + peer", () => {
    const tables = decompose({ data: [{ id: "a" }], meta: { total: 1 } });
    expect(paths(tables).sort()).toEqual(["$", "$.data"].sort());
    // Primary ($) has meta flattened + data as count-link.
    expect(tables[0]!.columns.map((c) => c.key).sort()).toEqual(["data", "meta.total"].sort());
  });

  test("pass_through_wrapper_row: object with only array fields gets _idx", () => {
    const tables = decompose([{ academicLevels: [{ priority: "primary" }] }]);
    // Primary: synthetic _idx + count-link for academicLevels.
    expect(tables[0]!.columns.map((c) => c.key)).toEqual(["_idx", "academicLevels"]);
    expect(tables[0]!.rows[0]!["_idx"]).toEqual({ kind: "scalar", value: 0 });
    // Peer exists.
    expect(tables[1]!.path).toBe("$[0].academicLevels");
  });

  test("nested_five_levels: programs → terms → sections → meetings → attendance", () => {
    const tables = decompose([
      {
        code: "CS-BS",
        terms: [
          {
            termCode: "2026FA",
            sections: [
              {
                crn: "12345",
                meetings: [
                  {
                    day: "MW",
                    attendance: [
                      { date: "2026-09-01", count: 42 },
                      { date: "2026-09-03", count: 40 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(paths(tables)).toEqual([
      "$",
      "$[*].terms",
      "$[*].terms[*].sections",
      "$[*].terms[*].sections[*].meetings",
      "$[*].terms[*].sections[*].meetings[*].attendance",
    ]);
    // Depths are 0..4.
    expect(tables.map((t) => t.depth)).toEqual([0, 1, 2, 3, 4]);
    // Leaf table has 2 attendance rows.
    expect(tables[4]!.rows).toHaveLength(2);
    expect(tables[4]!.columns.map((c) => c.key).sort()).toEqual(["_parent_idx", "count", "date"]);
  });

  test("array_of_arrays at the root emits one peer table per inner array", () => {
    const tables = decompose([
      [{ a: 1 }, { a: 2 }],
      [{ a: 3 }],
    ]);
    // Primary table: row per outer item, each a count-link to its inner.
    expect(paths(tables)).toEqual(["$", "$[0]", "$[1]"]);
    expect(tables[0]!.rows[0]![tables[0]!.columns.find((c) => c.kind === "count-link")!.key]!.kind).toBe("count-link");
  });

  test("heterogeneous_array splits into contiguous-run peer tables", () => {
    const tables = decompose([
      { a: 1 },
      { a: 2 },
      [{ b: 1 }],
      "scalar",
      { a: 3 },
    ]);
    // Primary $ retains nothing coherent; we split runs by kind.
    // Split into: $[0..1] (obj run), $[2] (arr), $[3] (scalar), $[4] (obj).
    const nonPrimary = tables.filter((t) => t.path !== "$");
    expect(nonPrimary.map((t) => t.path).sort()).toEqual(
      ["$[0..1]", "$[2]", "$[3]", "$[4]"].sort(),
    );
  });

  test("keys_with_dots are bracket-escaped in column keys and paths", () => {
    const tables = decompose([
      { "my.odd.key": "v", other: { "a.b": 1 } },
    ]);
    const cols = tables[0]!.columns.map((c) => c.key);
    expect(cols).toContain('["my.odd.key"]');
    // Nested dotted-flatten also escapes: column becomes other.["a.b"]
    expect(cols).toContain('other.["a.b"]');
  });

  test("wide_union truncates column display with hiddenColumnCount", () => {
    const row: Record<string, number> = {};
    for (let i = 0; i < 40; i++) row[`c${i.toString().padStart(2, "0")}`] = i;
    const tables = decompose([row]);
    expect(tables[0]!.hiddenColumnCount).toBe(20);
    expect(tables[0]!.columns).toHaveLength(20);
  });

  test("error_response_shape: { error, detail } → 2-col KV", () => {
    const tables = decompose({ error: "no-api-key", detail: "env 'x' has no key" });
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(1);
    expect(tables[0]!.columns.map((c) => c.key).sort()).toEqual(["detail", "error"]);
  });
});
