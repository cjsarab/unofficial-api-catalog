import { describe, expect, test } from "vitest";
import { tokenize } from "./highlight.ts";

function kindsOf(s: string): string[] {
  return tokenize(s).map((t) => t.kind);
}

describe("highlight.tokenize", () => {
  test("scalar constants", () => {
    expect(kindsOf("true")).toEqual(["bool"]);
    expect(kindsOf("false")).toEqual(["bool"]);
    expect(kindsOf("null")).toEqual(["null"]);
    expect(kindsOf("42")).toEqual(["number"]);
    expect(kindsOf("-3.14")).toEqual(["number"]);
    expect(kindsOf("1e9")).toEqual(["number"]);
    expect(kindsOf('"hi"')).toEqual(["string"]);
  });

  test("object with key / string / number", () => {
    const tokens = tokenize('{"id":"abc","n":7}');
    // Expected shape: punct { , key "id", punct :, string "abc", punct ,, key "n", punct :, number 7, punct }
    expect(tokens.map((t) => t.kind)).toEqual([
      "punct", "key", "punct", "string", "punct", "key", "punct", "number", "punct",
    ]);
    // Text roundtrip (no data lost):
    expect(tokens.map((t) => t.text).join("")).toBe('{"id":"abc","n":7}');
  });

  test("whitespace is preserved as ws kind", () => {
    const tokens = tokenize('{\n  "x": 1\n}');
    expect(tokens.map((t) => t.text).join("")).toBe('{\n  "x": 1\n}');
    // Kind sequence ignoring ws:
    const nonWs = tokens.filter((t) => t.kind !== "ws").map((t) => t.kind);
    expect(nonWs).toEqual(["punct", "key", "punct", "number", "punct"]);
  });

  test("arrays and nested structures", () => {
    const tokens = tokenize('[{"a":null},[true]]');
    expect(tokens.map((t) => t.kind).join(",")).toBe(
      "punct,punct,key,punct,null,punct,punct,punct,bool,punct,punct",
    );
  });

  test("escaped strings are kept intact (not truncated at the inner quote)", () => {
    const tokens = tokenize('"a\\"b"');
    expect(tokens).toEqual([{ kind: "string", text: '"a\\"b"' }]);
  });

  test("invalid input: preserves input as raw tokens rather than throwing", () => {
    // Not a full parser — we want graceful degradation on bad JSON.
    const tokens = tokenize("garb age");
    expect(tokens.map((t) => t.text).join("")).toBe("garb age");
  });
});
