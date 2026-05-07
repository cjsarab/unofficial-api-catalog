import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression: routes/environments.ts and proxy/ethos.ts each used to
// create their own EnvironmentStore (so their own in-memory cache).
// `setActive` from the routes side never propagated to the proxy side,
// and the proxy kept using the previous env's credentials. The fix is
// `server/stores.ts` exposing shared singletons.

describe("stores.ts shared singletons", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "acx-stores-test-"));
    // Re-import the modules under a fresh test-specific data dir so each
    // test starts with a clean singleton. vi.resetModules() drops the
    // cached singletons; vi.doMock rewires the path constants.
    vi.resetModules();
    vi.doMock("../server/config.ts", async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      return {
        ...actual,
        ENVIRONMENTS_PATH: join(dir, "environments.json"),
        SECRETS_PATH: join(dir, "secrets.json"),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("../server/config.ts");
    rmSync(dir, { recursive: true, force: true });
  });

  test("getEnvironmentStore returns the same instance on repeated calls", async () => {
    const stores = await import("../server/stores.ts");
    const a = stores.getEnvironmentStore();
    const b = stores.getEnvironmentStore();
    expect(a).toBe(b);
  });

  test("setActive via one reference is visible via another reference", async () => {
    // Simulates the routes handler calling setActive, and the proxy then
    // observing the new activeId. The bug was that they didn't share state.
    const stores = await import("../server/stores.ts");
    const routesView = stores.getEnvironmentStore();
    const envA = routesView.add({ name: "env-A", production: false, apiKey: "key-A" });
    const envB = routesView.add({ name: "env-B", production: true, apiKey: "key-B" });

    routesView.setActive(envA.id);

    const proxyView = stores.getEnvironmentStore();
    expect(proxyView.list().activeId).toBe(envA.id);

    routesView.setActive(envB.id);
    expect(proxyView.list().activeId).toBe(envB.id);
  });

  test("getApiKey via the shared store reflects the active env's key", async () => {
    const stores = await import("../server/stores.ts");
    const store = stores.getEnvironmentStore();
    const envA = store.add({ name: "env-A", production: false, apiKey: "key-A" });
    const envB = store.add({ name: "env-B", production: true, apiKey: "key-B" });

    store.setActive(envA.id);
    expect(store.getApiKey(store.list().activeId!)).toBe("key-A");

    store.setActive(envB.id);
    expect(store.getApiKey(store.list().activeId!)).toBe("key-B");
  });
});
