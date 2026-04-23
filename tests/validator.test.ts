import { describe, test, expect, beforeAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateCatalogPath,
  probeLikelyPaths,
  EXPECTED_FAMILIES,
} from "../server/validation/catalog.ts";

const FIXTURE_ROOT = join(tmpdir(), "apicatalog-test-" + Date.now());
const GOOD_CATALOG = join(FIXTURE_ROOT, "good-catalog");
const SUBFOLDER_MISTAKE = join(GOOD_CATALOG, "BannerBusAPIs");
const EMPTY_FOLDER = join(FIXTURE_ROOT, "empty");
const NON_CATALOG = join(FIXTURE_ROOT, "misc");
const FAKE_ZIP = join(FIXTURE_ROOT, "catalog.zip");
const MISSING = join(FIXTURE_ROOT, "does-not-exist");

beforeAll(async () => {
  // Clean slate
  await rm(FIXTURE_ROOT, { recursive: true, force: true });

  // Good catalog with a few families + some yaml files
  const familiesToCreate = ["BannerBusAPIs", "ColleagueEedmAPIs", "ApplyAPIs"];
  for (const fam of familiesToCreate) {
    const famPath = join(GOOD_CATALOG, fam);
    const r1 = join(famPath, "foo-1.0.0");
    const r2 = join(famPath, "bar-2.1.0");
    await mkdir(r1, { recursive: true });
    await mkdir(r2, { recursive: true });
    await writeFile(join(r1, "foo.yaml"), "openapi: 3.0.0\ninfo: {title: foo}\n");
    await writeFile(join(r2, "bar.yaml"), "openapi: 3.0.0\ninfo: {title: bar}\n");
  }

  await mkdir(EMPTY_FOLDER, { recursive: true });

  await mkdir(NON_CATALOG, { recursive: true });
  await writeFile(join(NON_CATALOG, "readme.txt"), "hello");
  await mkdir(join(NON_CATALOG, "notes"), { recursive: true });

  await writeFile(FAKE_ZIP, "PK\x03\x04 pretend zip");
});

describe("validateCatalogPath", () => {
  test("accepts a good catalog", async () => {
    const v = await validateCatalogPath(GOOD_CATALOG);
    expect(v.valid).toBe(true);
    expect(v.exists).toBe(true);
    expect(v.isDirectory).toBe(true);
    expect(v.familiesFound.map((f) => f.name).sort()).toEqual(
      ["ApplyAPIs", "BannerBusAPIs", "ColleagueEedmAPIs"],
    );
    expect(v.yamlCount).toBe(6); // 3 families × 2 resources × 1 yaml
    expect(v.familiesMissing.length).toBe(EXPECTED_FAMILIES.length - 3);
    expect(v.errors).toEqual([]);
  });

  test("rejects empty path", async () => {
    const v = await validateCatalogPath("");
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  test("rejects missing path", async () => {
    const v = await validateCatalogPath(MISSING);
    expect(v.valid).toBe(false);
    expect(v.exists).toBe(false);
    expect(v.errors.join(" ")).toMatch(/does not exist/i);
  });

  test("suggests parent when pointed at a single family folder", async () => {
    const v = await validateCatalogPath(SUBFOLDER_MISTAKE);
    expect(v.valid).toBe(false);
    expect(v.suggestedParent).toBe(GOOD_CATALOG);
    expect(v.warnings.join(" ")).toMatch(/looks like a single family folder/i);
  });

  test("flags zip files", async () => {
    const v = await validateCatalogPath(FAKE_ZIP);
    expect(v.valid).toBe(false);
    expect(v.isZip).toBe(true);
    expect(v.errors.join(" ")).toMatch(/zip/i);
  });

  test("rejects empty folder", async () => {
    const v = await validateCatalogPath(EMPTY_FOLDER);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/no .*APIs.* subdirectories/i);
  });

  test("rejects unrelated folder", async () => {
    const v = await validateCatalogPath(NON_CATALOG);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/no .*APIs.* subdirectories/i);
  });

  test("partial catalog is valid with a warning about missing families", async () => {
    const v = await validateCatalogPath(GOOD_CATALOG);
    expect(v.valid).toBe(true);
    expect(v.familiesMissing.length).toBeGreaterThan(0);
  });
});

describe("probeLikelyPaths", () => {
  test("returns a deduplicated list of folder candidates", async () => {
    const paths = await probeLikelyPaths({
      lastKnownPath: GOOD_CATALOG,
      recent: [GOOD_CATALOG, GOOD_CATALOG, EMPTY_FOLDER],
    });
    // No duplicates
    expect(new Set(paths).size).toBe(paths.length);
    // Everything returned is a real folder
    expect(paths.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });

  test("tolerates a non-existent lastKnownPath", async () => {
    const paths = await probeLikelyPaths({ lastKnownPath: MISSING });
    expect(Array.isArray(paths)).toBe(true);
  });
});
