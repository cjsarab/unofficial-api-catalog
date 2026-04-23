import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSecretStore } from "../server/auth/secrets.ts";
import { createEnvironmentStore } from "../server/environments/store.ts";

describe("environment store", () => {
  let dir: string;
  let envPath: string;
  let secretPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acx-env-test-"));
    envPath = join(dir, "environments.json");
    secretPath = join(dir, "secrets.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("fresh store returns empty list and null activeId", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(store.list()).toEqual({ envs: [], activeId: null });
  });

  test("add creates an env with server-generated id and stores the apiKey", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const created = store.add({
      name: "apply-prod",
      production: true,
      apiKey: "sek-ret",
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.name).toBe("apply-prod");
    expect(created.hasApiKey).toBe(true);
    // apiKey must NOT be on the returned record
    expect((created as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    // The secret must actually be retrievable under the expected key
    expect(secrets.getSecret(`env/${created.id}/api_key`)).toBe("sek-ret");
  });

  test("list returns the added env with hasApiKey flag and no secret", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    store.add({
      name: "apply-prod",
      production: false,
      apiKey: "k",
    });
    const { envs, activeId } = store.list();
    expect(envs).toHaveLength(1);
    expect(envs[0]!.hasApiKey).toBe(true);
    expect(activeId).toBeNull();
  });

  test("add rejects duplicate name", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    store.add({ name: "x", production: false, apiKey: "k" });
    expect(() =>
      store.add({ name: "x", production: false, apiKey: "k2" }),
    ).toThrow(/name.*exists|already/i);
  });

  test("add rejects empty name after trim", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() =>
      store.add({ name: "   ", production: false, apiKey: "k" }),
    ).toThrow(/name/i);
  });

  test("add rejects empty apiKey", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() =>
      store.add({ name: "x", production: false, apiKey: "" }),
    ).toThrow(/apiKey|api key/i);
  });

  test("add trims name before storing", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const created = store.add({
      name: "  padded  ",
      production: false,
      apiKey: "k",
    });
    expect(created.name).toBe("padded");
  });

  test("update renames without touching apiKey", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "old", production: false, apiKey: "k" });
    const b = store.update(a.id, { name: "new" });
    expect(b.name).toBe("new");
    expect(b.id).toBe(a.id);
    expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("k");
  });

  test("update with apiKey replaces the stored secret", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "old-key" });
    store.update(a.id, { apiKey: "new-key" });
    expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("new-key");
  });

  test("update without apiKey leaves secret unchanged", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "k" });
    store.update(a.id, { production: true });
    expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("k");
  });

  test("update rejects renaming to an in-use name", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    store.add({ name: "a", production: false, apiKey: "k" });
    const b = store.add({ name: "b", production: false, apiKey: "k" });
    expect(() => store.update(b.id, { name: "a" })).toThrow(/already|exists/i);
  });

  test("update allows renaming to the current name (no-op)", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "a", production: false, apiKey: "k" });
    const b = store.update(a.id, { name: "a" });
    expect(b.name).toBe("a");
  });

  test("update throws when env id not found", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() => store.update("does-not-exist", { name: "x" })).toThrow(/not found/i);
  });

  test("delete removes the env and its secret", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "k" });
    store.delete(a.id);
    expect(store.get(a.id)).toBeNull();
    expect(secrets.getSecret(`env/${a.id}/api_key`)).toBeNull();
  });

  test("delete of the active env clears activeId", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "k" });
    store.setActive(a.id);
    store.delete(a.id);
    expect(store.list().activeId).toBeNull();
  });

  test("delete of a non-active env leaves activeId unchanged", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "a", production: false, apiKey: "k" });
    const b = store.add({ name: "b", production: false, apiKey: "k" });
    store.setActive(a.id);
    store.delete(b.id);
    expect(store.list().activeId).toBe(a.id);
  });

  test("delete of a non-existent env throws", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() => store.delete("nope")).toThrow(/not found/i);
  });

  test("setActive stores the id; list reflects it", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "k" });
    store.setActive(a.id);
    expect(store.list().activeId).toBe(a.id);
  });

  test("setActive with an unknown id throws", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() => store.setActive("unknown")).toThrow(/not found/i);
  });

  test("setActive persists across a fresh store instance", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const a = store.add({ name: "e", production: false, apiKey: "k" });
    store.setActive(a.id);
    // Fresh instance, same file — exercises load() path.
    const store2 = createEnvironmentStore(envPath, secrets);
    expect(store2.list().activeId).toBe(a.id);
  });

  test("malformed environments.json throws with a clear message", () => {
    writeFileSync(envPath, "{not valid json", "utf8");
    const secrets = createSecretStore(secretPath);
    expect(() => createEnvironmentStore(envPath, secrets).list()).toThrow(/not valid JSON/);
  });

  test("environments.json that is not an object throws", () => {
    writeFileSync(envPath, "[1,2,3]", "utf8");
    const secrets = createSecretStore(secretPath);
    expect(() => createEnvironmentStore(envPath, secrets).list()).toThrow(/JSON object/);
  });

  test("activeId pointing at a missing env is coerced to null on load", () => {
    writeFileSync(
      envPath,
      JSON.stringify({ envs: [], activeId: "ghost-id" }, null, 2),
      "utf8",
    );
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(store.list().activeId).toBeNull();
  });

  test("getApiKey returns the stored key", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const e = store.add({ name: "e", production: false, apiKey: "my-secret-key" });
    expect(store.getApiKey(e.id)).toBe("my-secret-key");
  });

  test("getApiKey throws when env id not found", () => {
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    expect(() => store.getApiKey("nope")).toThrow(/not found/i);
  });

  test("legacy defaultHeaders field on disk is stripped on load", () => {
    writeFileSync(
      envPath,
      JSON.stringify(
        {
          envs: [
            {
              id: "legacy-id",
              name: "legacy",
              production: false,
              defaultHeaders: { Accept: "application/json" },
            },
          ],
          activeId: null,
        },
        null,
        2,
      ),
      "utf8",
    );
    const secrets = createSecretStore(secretPath);
    const store = createEnvironmentStore(envPath, secrets);
    const { envs } = store.list();
    expect(envs).toHaveLength(1);
    expect(envs[0]).not.toHaveProperty("defaultHeaders");
  });
});
