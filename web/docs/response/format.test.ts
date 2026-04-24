import { describe, expect, test } from "bun:test";
import { formatBytes, formatMs } from "./format.ts";

describe("formatBytes", () => {
  test("bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  test("kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(108701)).toBe("106.2 KB");
  });
  test("megabytes with two decimals", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(2_500_000)).toBe("2.38 MB");
  });
  test("invalid inputs degrade to 0 B", () => {
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("formatMs", () => {
  test("zero and sub-ms → < 1 ms", () => {
    expect(formatMs(0)).toBe("< 1 ms");
    expect(formatMs(0.4)).toBe("< 1 ms");
  });
  test("whole ms values", () => {
    expect(formatMs(1)).toBe("1 ms");
    expect(formatMs(42)).toBe("42 ms");
    expect(formatMs(999)).toBe("999 ms");
  });
  test("seconds with two decimals at 1000+", () => {
    expect(formatMs(1000)).toBe("1.00 s");
    expect(formatMs(2346)).toBe("2.35 s");
    expect(formatMs(12345)).toBe("12.35 s");
  });
  test("invalid → 0 ms", () => {
    expect(formatMs(NaN)).toBe("0 ms");
    expect(formatMs(-1)).toBe("0 ms");
  });
});
