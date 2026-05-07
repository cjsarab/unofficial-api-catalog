import { describe, expect, test } from "vitest";
import { buildSkeleton } from "./build-skeleton.ts";

describe("buildSkeleton — primitives", () => {
  test("string with no format returns empty string", () => {
    expect(buildSkeleton({ type: "string" })).toBe("");
  });
  test("uuid string returns the zero UUID placeholder", () => {
    expect(buildSkeleton({ type: "string", format: "uuid" })).toBe("00000000-0000-0000-0000-000000000000");
  });
  test("integer returns 0 (or minimum when given)", () => {
    expect(buildSkeleton({ type: "integer" })).toBe(0);
    expect(buildSkeleton({ type: "integer", minimum: 5 })).toBe(5);
  });
  test("boolean returns false", () => {
    expect(buildSkeleton({ type: "boolean" })).toBe(false);
  });
  test("default beats type", () => {
    expect(buildSkeleton({ type: "string", default: "hello" })).toBe("hello");
  });
  test("enum returns the first option", () => {
    expect(buildSkeleton({ type: "string", enum: ["a", "b", "c"] })).toBe("a");
  });
});

describe("buildSkeleton — objects", () => {
  test("only required fields populated; optionals omitted", () => {
    const result = buildSkeleton({
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        nickname: { type: "string" },
      },
    });
    expect(result).toEqual({ id: "" });
  });

  test("typeless object with properties is treated as object", () => {
    // Some specs omit `type: object` — buildSkeleton should still walk it.
    const result = buildSkeleton({
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
    } as unknown as Parameters<typeof buildSkeleton>[0]);
    expect(result).toEqual({ id: "00000000-0000-0000-0000-000000000000" });
  });

  test("nested required objects build recursively", () => {
    const result = buildSkeleton({
      type: "object",
      required: ["address"],
      properties: {
        address: {
          type: "object",
          required: ["city"],
          properties: { city: { type: "string" } },
        },
      },
    });
    expect(result).toEqual({ address: { city: "" } });
  });
});

describe("buildSkeleton — arrays", () => {
  test("array with primitive items returns one stub item", () => {
    expect(buildSkeleton({ type: "array", items: { type: "integer" } })).toEqual([0]);
  });
  test("array of objects returns one required-fields stub", () => {
    const result = buildSkeleton({
      type: "array",
      items: {
        type: "object",
        required: ["code"],
        properties: { code: { type: "string" }, label: { type: "string" } },
      },
    });
    expect(result).toEqual([{ code: "" }]);
  });
});

describe("buildSkeleton — composition keywords", () => {
  test("oneOf picks the first variant", () => {
    const result = buildSkeleton({
      oneOf: [
        { type: "object", required: ["a"], properties: { a: { type: "string" } } },
        { type: "object", required: ["b"], properties: { b: { type: "integer" } } },
      ],
    });
    expect(result).toEqual({ a: "" });
  });

  test("anyOf picks the first variant", () => {
    const result = buildSkeleton({
      anyOf: [
        { type: "string" },
        { type: "integer" },
      ],
    });
    expect(result).toBe("");
  });

  test("allOf merges required + properties from every variant", () => {
    const result = buildSkeleton({
      allOf: [
        { type: "object", required: ["base"], properties: { base: { type: "string" } } },
        { type: "object", required: ["extra"], properties: { extra: { type: "integer" } } },
      ],
    });
    expect(result).toEqual({ base: "", extra: 0 });
  });

  test("allOf later variant wins on key collision (extension intent)", () => {
    const result = buildSkeleton({
      allOf: [
        { type: "object", required: ["x"], properties: { x: { type: "string", default: "base" } } },
        { type: "object", properties: { x: { type: "string", default: "override" } } },
      ],
    });
    expect(result).toEqual({ x: "override" });
  });
});

describe("buildSkeleton — fallback behaviour", () => {
  test("undefined schema yields empty object (friendly default for body context)", () => {
    expect(buildSkeleton(undefined)).toEqual({});
  });
  test("schema we can't classify yields {} not literal null", () => {
    // The user-reported bug: previous version returned null here.
    expect(buildSkeleton({} as Parameters<typeof buildSkeleton>[0])).toEqual({});
  });
});
