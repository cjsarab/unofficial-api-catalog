import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSecretStore } from "../server/auth/secrets.ts";

describe("secrets store", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acx-secrets-test-"));
    path = join(dir, "secrets.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("set/get round-trip — basic ASCII", () => {
    const store = createSecretStore(path);
    store.setSecret("foo", "abc123");
    expect(store.getSecret("foo")).toBe("abc123");
  });

  test("set/get round-trip — unicode", () => {
    const store = createSecretStore(path);
    const value = "héllo 世界 🔐";
    store.setSecret("k", value);
    expect(store.getSecret("k")).toBe(value);
  });

  test("delete removes key; subsequent getSecret returns null", () => {
    const store = createSecretStore(path);
    store.setSecret("k", "v");
    store.deleteSecret("k");
    expect(store.getSecret("k")).toBeNull();
  });

  test("listSecretKeys returns all current keys", () => {
    const store = createSecretStore(path);
    store.setSecret("a", "1");
    store.setSecret("b", "2");
    store.setSecret("c", "3");
    expect(store.listSecretKeys().sort()).toEqual(["a", "b", "c"]);
  });

  test("plaintext does NOT appear on disk", () => {
    const store = createSecretStore(path);
    const secret = "PLAINTEXT_SHOULD_NOT_LEAK_a3f9bc";
    store.setSecret("k", secret);
    const onDisk = readFileSync(path, "utf8");
    expect(onDisk).not.toContain(secret);
  });

  test("persistence across fresh module load", () => {
    const a = createSecretStore(path);
    a.setSecret("foo", "secret-value");
    // Fresh instance pointed at the same file — exercises the load() path.
    const b = createSecretStore(path);
    expect(b.getSecret("foo")).toBe("secret-value");
  });

  test("tampered ciphertext throws", () => {
    const writer = createSecretStore(path);
    writer.setSecret("k", "original");

    // Corrupt the stored ciphertext directly on disk. "AA…==" is valid base64
    // but is NOT a valid DPAPI blob, so unprotect must reject it.
    const map = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    map["k"] = "AAAAAAAAAAAAAAAAAAAAAA==";
    writeFileSync(path, JSON.stringify(map), "utf8");

    // Fresh store skips the in-memory cache and re-reads the corrupted file.
    const reader = createSecretStore(path);
    expect(() => reader.getSecret("k")).toThrow();
  });
});
