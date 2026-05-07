# Environment Profile Manager Implementation Plan

> **Partially obsolete — DPAPI references no longer apply.** The DPAPI integration described here was removed in the 2026-05-01 pivot; secret storage is now plaintext in `./data/secrets.json`. The rest of the plan (CRUD, active-env, top-bar selector) is current.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Settings → Environments CRUD + persisted active-env + top-bar selector, so Phase 2 can consume one configured Ellucian tenant environment. No token exchange, no proxy, no test-connection — those are separate Phase 2 slices.

**Architecture:** Three-layer split parallel to `server/auth/`. `server/environments/store.ts` is a factory returning a pure data-model store (list/get/add/update/delete/setActive) over `environments.json`, reusing the existing DPAPI `SecretStore` for per-env API keys keyed as `env/<id>/api_key`. `server/routes/environments.ts` is a thin HTTP adapter registered in the dispatcher. The frontend adds a `/settings/environments` route (custom History-API routing, Svelte 5 runes) with a section-aware Settings shell, an inline-expand CRUD panel, and wires the existing TopBar env-selector stub to real data.

**Tech Stack:** Bun, TypeScript (strict + verbatimModuleSyntax), `bun:test`, node:fs (sync), Svelte 5 runes, Vite, CSS custom properties (existing `--danger`, new `--accent-active`).

**Spec:** `docs/superpowers/specs/2026-04-23-env-profile-manager-design.md`

**Repo state:** This project is **not** a git repo. Each task ends with a `Verify` step (typecheck + tests, or manual browser check for UI tasks). Per-task boundaries are natural commit candidates if the user later runs `git init`.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `server/environments/store.ts` | Create (~180 lines) | Data model types + `createEnvironmentStore(path, secretStore)` factory. All validation, atomic writes, secret cascading live here. |
| `server/routes/environments.ts` | Create (~100 lines) | Five HTTP handlers (GET list, POST create, PATCH update, DELETE, POST activate). Thin adapter over the store. |
| `server/routes/index.ts` | Modify (+2 lines) | Import + register `handleEnvironments` in the dispatcher array. |
| `tests/environments.test.ts` | Create (~250 lines, ~15 tests) | Integration tests — real DPAPI secret store against a temp `secrets.json`, real env store against a temp `environments.json`. |
| `web/App.svelte` | Modify | Add route variant, env state, fetch on mount, pass-down to children. |
| `web/settings/SettingsView.svelte` | Create (~30 lines) | Section-aware Settings shell. One section rendered today. |
| `web/settings/EnvironmentsPanel.svelte` | Create (~300 lines) | List + inline-expand add/edit form. Delete confirm. Active highlight. |
| `web/shell/TopBar.svelte` | Modify | Replace disabled stub selector with real data-wired one; add red-dot indicator + gear icon. |
| `web/shell/StatusBar.svelte` | Modify (trivial) | Consume resolved active-env name; no structural change. |
| `web/shell/CommandPalette.svelte` | (not modified) | Scoped out — see note below. |
| `web/styles/theme.css` | Modify | Add `--accent-active` variable per theme block. (`--danger` already red on every theme; reused for PROD.) |
| `PLAN.md` | Modify | 5 cleanup edits (auth model correction, removed secondary auth modes, frontend path correction, vestigial safety-settings, expanded Phase 2 item 1). |

**Scope note on the command palette:** the spec called for a `Settings: Environments` palette command. On inspection, `CommandPalette.svelte` is a server-backed search UI with no static commands list today — adding one would be a modest refactor. That's out of scope for this slice. The gear icon in the top bar, the URL bar, and browser bookmarks cover the navigation need in the meantime. Noted as a deferred follow-up.

---

## Task 1: Write the first failing store test

**Files:**
- Create: `tests/environments.test.ts`

- [ ] **Step 1: Create the test file with a single list-empty test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `./bun.exe test tests/environments.test.ts`
Expected: a resolution failure — `error: Cannot find module '../server/environments/store.ts'`. If the failure is about anything else (e.g. test syntax, `createSecretStore`), fix the test first.

---

## Task 2: Scaffold the store and pass the first test

**Files:**
- Create: `server/environments/store.ts`

- [ ] **Step 1: Write `server/environments/store.ts` with enough to pass test 1**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SecretStore } from "../auth/secrets.ts";

export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  authUrl?: string;
  production: boolean;
  defaultHeaders: Record<string, string>;
}

export interface EnvironmentWithStatus extends Environment {
  hasApiKey: boolean;
}

export interface CreateEnvironmentInput {
  name: string;
  baseUrl: string;
  authUrl?: string;
  production: boolean;
  defaultHeaders: Record<string, string>;
  apiKey: string;
}

export interface UpdateEnvironmentInput {
  name?: string;
  baseUrl?: string;
  authUrl?: string | null;
  production?: boolean;
  defaultHeaders?: Record<string, string>;
  apiKey?: string;
}

export interface EnvironmentStore {
  list(): { envs: EnvironmentWithStatus[]; activeId: string | null };
  get(id: string): EnvironmentWithStatus | null;
  add(input: CreateEnvironmentInput): EnvironmentWithStatus;
  update(id: string, input: UpdateEnvironmentInput): EnvironmentWithStatus;
  delete(id: string): void;
  setActive(id: string): void;
}

// On-disk shape. `activeId` is null when no env is active.
interface DiskState {
  envs: Environment[];
  activeId: string | null;
}

const SECRET_KEY = (id: string) => `env/${id}/api_key`;

export function createEnvironmentStore(
  filePath: string,
  secretStore: SecretStore,
): EnvironmentStore {
  let cache: DiskState | undefined;

  function load(): DiskState {
    if (cache !== undefined) return cache;
    if (!existsSync(filePath)) {
      cache = { envs: [], activeId: null };
      return cache;
    }
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error(`Failed to read ${filePath}: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${filePath} is not valid JSON: ${(err as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON object`);
    }
    const p = parsed as Partial<DiskState>;
    if (!Array.isArray(p.envs)) {
      throw new Error(`${filePath} is missing or has invalid 'envs' array`);
    }
    cache = {
      envs: p.envs,
      activeId: typeof p.activeId === "string" ? p.activeId : null,
    };
    return cache;
  }

  function flush(): void {
    if (!cache) return;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
    renameSync(tmp, filePath);
  }

  function decorate(env: Environment): EnvironmentWithStatus {
    return { ...env, hasApiKey: secretStore.listSecretKeys().includes(SECRET_KEY(env.id)) };
  }

  return {
    list() {
      const s = load();
      return { envs: s.envs.map(decorate), activeId: s.activeId };
    },
    get(id) {
      const s = load();
      const env = s.envs.find((e) => e.id === id);
      return env ? decorate(env) : null;
    },
    add(_input) {
      throw new Error("not yet implemented");
    },
    update(_id, _input) {
      throw new Error("not yet implemented");
    },
    delete(_id) {
      throw new Error("not yet implemented");
    },
    setActive(_id) {
      throw new Error("not yet implemented");
    },
  };
}
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `./bun.exe test tests/environments.test.ts`
Expected:
```
 1 pass
 0 fail
```

- [ ] **Step 3: Verify full suite and typecheck**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **55 pass / 0 fail** (54 pre-existing + 1 new).

---

## Task 3: Implement `add` and `get`, with validation

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`

- [ ] **Step 1: Append these tests inside the existing `describe` block**

```ts
test("add creates an env with server-generated id and stores the apiKey", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const created = store.add({
    name: "apply-prod",
    baseUrl: "https://integrate.elluciancloud.com",
    production: true,
    defaultHeaders: { Accept: "application/vnd.hedtech.integration.v13+json" },
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
    baseUrl: "https://integrate.elluciancloud.com",
    production: false,
    defaultHeaders: {},
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
  store.add({ name: "x", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  expect(() =>
    store.add({ name: "x", baseUrl: "https://b.example", production: false, defaultHeaders: {}, apiKey: "k2" }),
  ).toThrow(/name.*exists|already/i);
});

test("add rejects empty name after trim", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  expect(() =>
    store.add({ name: "   ", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" }),
  ).toThrow(/name/i);
});

test("add rejects invalid baseUrl", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  expect(() =>
    store.add({ name: "x", baseUrl: "not-a-url", production: false, defaultHeaders: {}, apiKey: "k" }),
  ).toThrow(/baseUrl|url/i);
});

test("add rejects empty apiKey", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  expect(() =>
    store.add({ name: "x", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "" }),
  ).toThrow(/apiKey|api key/i);
});

test("add trims name before storing", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const created = store.add({
    name: "  padded  ",
    baseUrl: "https://a.example",
    production: false,
    defaultHeaders: {},
    apiKey: "k",
  });
  expect(created.name).toBe("padded");
});
```

- [ ] **Step 2: Run the new tests; they should fail**

Run: `./bun.exe test tests/environments.test.ts`
Expected: the 7 new tests fail with `not yet implemented` (or similar) — the old 1 still passes.

- [ ] **Step 3: Replace the `add` stub with a real implementation**

In `server/environments/store.ts`, replace the `add(_input)` stub with:

```ts
    add(input) {
      const s = load();
      const name = input.name.trim();
      if (!name) throw new Error("name must not be empty");
      if (s.envs.some((e) => e.name === name)) {
        throw new Error(`an environment named "${name}" already exists`);
      }
      assertHttpUrl("baseUrl", input.baseUrl);
      if (input.authUrl !== undefined) assertHttpUrl("authUrl", input.authUrl);
      if (!input.apiKey) throw new Error("apiKey must not be empty");

      const env: Environment = {
        id: crypto.randomUUID(),
        name,
        baseUrl: input.baseUrl,
        authUrl: input.authUrl,
        production: input.production,
        defaultHeaders: input.defaultHeaders,
      };
      s.envs.push(env);
      flush();
      secretStore.setSecret(SECRET_KEY(env.id), input.apiKey);
      return decorate(env);
    },
```

Add this helper at the bottom of the module (outside the factory closure, above it is fine):

```ts
function assertHttpUrl(field: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} is not a valid URL: "${value}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be http or https, got "${parsed.protocol}"`);
  }
}
```

(Place `assertHttpUrl` and `SECRET_KEY` near the top of the file, before `createEnvironmentStore`.)

- [ ] **Step 4: Run the tests and confirm all pass**

Run: `./bun.exe test tests/environments.test.ts`
Expected:
```
 8 pass
 0 fail
```

- [ ] **Step 5: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **62 pass / 0 fail** (54 + 8 new).

---

## Task 4: Implement `update` (rename, apiKey rotation, partial updates)

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`

- [ ] **Step 1: Append these tests**

```ts
test("update renames without touching apiKey", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "old", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  const b = store.update(a.id, { name: "new" });
  expect(b.name).toBe("new");
  expect(b.id).toBe(a.id);
  expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("k");
});

test("update with apiKey replaces the stored secret", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "old-key" });
  store.update(a.id, { apiKey: "new-key" });
  expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("new-key");
});

test("update without apiKey leaves secret unchanged", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  store.update(a.id, { production: true });
  expect(secrets.getSecret(`env/${a.id}/api_key`)).toBe("k");
});

test("update rejects renaming to an in-use name", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  store.add({ name: "a", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  const b = store.add({ name: "b", baseUrl: "https://b.example", production: false, defaultHeaders: {}, apiKey: "k" });
  expect(() => store.update(b.id, { name: "a" })).toThrow(/already|exists/i);
});

test("update allows renaming to the current name (no-op)", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "a", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  const b = store.update(a.id, { name: "a" });
  expect(b.name).toBe("a");
});

test("update rejects invalid baseUrl", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  expect(() => store.update(a.id, { baseUrl: "nope" })).toThrow(/baseUrl|url/i);
});

test("update with authUrl:null clears the override", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({
    name: "e",
    baseUrl: "https://a.example",
    authUrl: "https://auth.example",
    production: false,
    defaultHeaders: {},
    apiKey: "k",
  });
  const b = store.update(a.id, { authUrl: null });
  expect(b.authUrl).toBeUndefined();
});

test("update throws when env id not found", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  expect(() => store.update("does-not-exist", { name: "x" })).toThrow(/not found/i);
});
```

- [ ] **Step 2: Replace the `update` stub**

In `store.ts`, replace the `update` stub with:

```ts
    update(id, input) {
      const s = load();
      const env = s.envs.find((e) => e.id === id);
      if (!env) throw new Error(`environment "${id}" not found`);

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new Error("name must not be empty");
        if (s.envs.some((e) => e.id !== id && e.name === name)) {
          throw new Error(`an environment named "${name}" already exists`);
        }
        env.name = name;
      }
      if (input.baseUrl !== undefined) {
        assertHttpUrl("baseUrl", input.baseUrl);
        env.baseUrl = input.baseUrl;
      }
      if (input.authUrl !== undefined) {
        if (input.authUrl === null) {
          delete env.authUrl;
        } else {
          assertHttpUrl("authUrl", input.authUrl);
          env.authUrl = input.authUrl;
        }
      }
      if (input.production !== undefined) env.production = input.production;
      if (input.defaultHeaders !== undefined) env.defaultHeaders = input.defaultHeaders;

      flush();

      if (input.apiKey !== undefined) {
        if (!input.apiKey) throw new Error("apiKey must not be empty");
        secretStore.setSecret(SECRET_KEY(env.id), input.apiKey);
      }

      return decorate(env);
    },
```

- [ ] **Step 3: Run tests and confirm all pass**

Run: `./bun.exe test tests/environments.test.ts`
Expected: **16 pass / 0 fail**.

- [ ] **Step 4: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **70 pass / 0 fail**.

---

## Task 5: Implement `delete` (cascades secret, clears active)

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`

- [ ] **Step 1: Append these tests**

```ts
test("delete removes the env and its secret", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  store.delete(a.id);
  expect(store.get(a.id)).toBeNull();
  expect(secrets.getSecret(`env/${a.id}/api_key`)).toBeNull();
});

test("delete of the active env clears activeId", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  store.setActive(a.id);
  store.delete(a.id);
  expect(store.list().activeId).toBeNull();
});

test("delete of a non-active env leaves activeId unchanged", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "a", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  const b = store.add({ name: "b", baseUrl: "https://b.example", production: false, defaultHeaders: {}, apiKey: "k" });
  store.setActive(a.id);
  store.delete(b.id);
  expect(store.list().activeId).toBe(a.id);
});

test("delete of a non-existent env throws", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  expect(() => store.delete("nope")).toThrow(/not found/i);
});
```

- [ ] **Step 2: Replace the `delete` stub**

```ts
    delete(id) {
      const s = load();
      const idx = s.envs.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`environment "${id}" not found`);
      s.envs.splice(idx, 1);
      if (s.activeId === id) s.activeId = null;
      flush();
      // Secret cleanup is best-effort from a durability standpoint (see spec
      // "Delete / rename semantics"): the env record is already gone, so a
      // leftover secret key is orphaned-but-harmless.
      secretStore.deleteSecret(SECRET_KEY(id));
    },
```

- [ ] **Step 3: Run tests and confirm all pass**

Run: `./bun.exe test tests/environments.test.ts`
Expected: **20 pass / 0 fail** (one of these tests — "delete of the active env" — depends on `setActive`, which is still a stub; that test will fail until Task 6. Expected instead: **19 pass / 1 fail**, with the failing test being the `setActive`-dependent one.)

- [ ] **Step 4: Temporarily confirm the failing test is only the `setActive`-dependent one**

If there are additional failures, fix them before proceeding. The only expected failure is the `"delete of the active env clears activeId"` test.

---

## Task 6: Implement `setActive`

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`

- [ ] **Step 1: Append these tests**

```ts
test("setActive stores the id; list reflects it", () => {
  const secrets = createSecretStore(secretPath);
  const store = createEnvironmentStore(envPath, secrets);
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
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
  const a = store.add({ name: "e", baseUrl: "https://a.example", production: false, defaultHeaders: {}, apiKey: "k" });
  store.setActive(a.id);
  // Fresh instance, same file — exercises load() path.
  const store2 = createEnvironmentStore(envPath, secrets);
  expect(store2.list().activeId).toBe(a.id);
});
```

- [ ] **Step 2: Replace the `setActive` stub**

```ts
    setActive(id) {
      const s = load();
      if (!s.envs.some((e) => e.id === id)) {
        throw new Error(`environment "${id}" not found`);
      }
      s.activeId = id;
      flush();
    },
```

- [ ] **Step 3: Run tests and confirm all pass**

Run: `./bun.exe test tests/environments.test.ts`
Expected: **23 pass / 0 fail**.

- [ ] **Step 4: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **77 pass / 0 fail**.

---

## Task 7: Load-time robustness (corrupt JSON, stale activeId)

**Files:**
- Modify: `server/environments/store.ts`
- Modify: `tests/environments.test.ts`

- [ ] **Step 1: Append these tests**

```ts
import { writeFileSync as writeFile } from "node:fs"; // add to the top imports if not already present

// ... inside the describe block ...

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
```

**Note on imports:** extend the existing `import { mkdtempSync, rmSync } from "node:fs";` line at the top of the test file to also import `writeFileSync`:
```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
```
(The `writeFile as writeFileSync` import hint above was a placeholder; use the real symbol.)

- [ ] **Step 2: Add the stale-activeId coercion to `load()`**

In `store.ts`, update the end of `load()` from:

```ts
    cache = {
      envs: p.envs,
      activeId: typeof p.activeId === "string" ? p.activeId : null,
    };
    return cache;
```

to:

```ts
    const activeIdRaw = typeof p.activeId === "string" ? p.activeId : null;
    // If activeId points at an env that no longer exists (file hand-edited, or
    // crash between env-list write and later operations), coerce to null rather
    // than letting a dangling reference hide bugs downstream.
    const activeId = activeIdRaw && p.envs.some((e) => e.id === activeIdRaw) ? activeIdRaw : null;
    cache = { envs: p.envs, activeId };
    return cache;
```

- [ ] **Step 3: Run tests and confirm all pass**

Run: `./bun.exe test tests/environments.test.ts`
Expected: **26 pass / 0 fail**.

- [ ] **Step 4: Verify full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail**.

---

## Task 8: HTTP route module + dispatcher wire-up

**Files:**
- Create: `server/routes/environments.ts`
- Modify: `server/routes/index.ts`

No new route-level unit tests — the store is thoroughly covered; the route module is a thin adapter. Smoke coverage happens via manual curl in Step 4 and the subsequent frontend wiring.

- [ ] **Step 1: Create `server/routes/environments.ts`**

```ts
import type { RouteHandler } from "./types.ts";
import { SECRETS_PATH, ENVIRONMENTS_PATH } from "../config.ts";
import { createSecretStore } from "../auth/secrets.ts";
import {
  createEnvironmentStore,
  type EnvironmentStore,
  type CreateEnvironmentInput,
  type UpdateEnvironmentInput,
} from "../environments/store.ts";

// Singleton. Bun's FFI / DPAPI handles are effectively free; the real cost
// is file reads on first call, which the store caches internally.
let store: EnvironmentStore | undefined;
function getStore(): EnvironmentStore {
  if (!store) {
    const secrets = createSecretStore(SECRETS_PATH);
    store = createEnvironmentStore(ENVIRONMENTS_PATH, secrets);
  }
  return store;
}

function err(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export const handleEnvironments: RouteHandler = async (req, url) => {
  if (!url.pathname.startsWith("/api/environments")) return undefined;

  const rest = url.pathname.slice("/api/environments".length); // "" | "/<id>" | "/<id>/activate"

  // GET /api/environments
  if (rest === "" && req.method === "GET") {
    try {
      return Response.json(getStore().list());
    } catch (e) {
      return err((e as Error).message, 500);
    }
  }

  // POST /api/environments
  if (rest === "" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as Partial<CreateEnvironmentInput> | null;
    if (!body) return err("malformed JSON body", 400);
    try {
      const created = getStore().add({
        name: String(body.name ?? ""),
        baseUrl: String(body.baseUrl ?? ""),
        authUrl: body.authUrl === undefined || body.authUrl === null ? undefined : String(body.authUrl),
        production: Boolean(body.production),
        defaultHeaders:
          body.defaultHeaders && typeof body.defaultHeaders === "object" ? body.defaultHeaders : {},
        apiKey: String(body.apiKey ?? ""),
      });
      return Response.json(created, { status: 201 });
    } catch (e) {
      return err((e as Error).message, 400);
    }
  }

  // Paths below all match "/<id>..." — pull the id.
  const m = rest.match(/^\/([^\/]+)(\/activate)?$/);
  if (!m) return err("not found", 404);
  const id = decodeURIComponent(m[1]!);
  const isActivate = !!m[2];

  // POST /api/environments/:id/activate
  if (isActivate && req.method === "POST") {
    try {
      getStore().setActive(id);
      return Response.json({ activeId: id });
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 400);
    }
  }

  // PATCH /api/environments/:id
  if (!isActivate && req.method === "PATCH") {
    const body = (await req.json().catch(() => null)) as Partial<UpdateEnvironmentInput> | null;
    if (!body) return err("malformed JSON body", 400);
    try {
      const updated = getStore().update(id, body);
      return Response.json(updated);
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 400);
    }
  }

  // DELETE /api/environments/:id
  if (!isActivate && req.method === "DELETE") {
    try {
      getStore().delete(id);
      return new Response(null, { status: 204 });
    } catch (e) {
      const msg = (e as Error).message;
      return err(msg, /not found/i.test(msg) ? 404 : 500);
    }
  }

  return undefined; // fall through to the dispatcher's 501 for unmatched methods
};
```

- [ ] **Step 2: Register the handler in the dispatcher**

In `server/routes/index.ts`, add the import and the array entry:

Before:
```ts
import { handleConfig } from "./config.ts";
```
After (add new line below):
```ts
import { handleConfig } from "./config.ts";
import { handleEnvironments } from "./environments.ts";
```

Then in the `apiHandlers` array, add `handleEnvironments` after `handleConfig`:

Before:
```ts
const apiHandlers: RouteHandler[] = [
  handleStatus,
  handleConfig,
  handleCatalog,
  ...
];
```
After:
```ts
const apiHandlers: RouteHandler[] = [
  handleStatus,
  handleConfig,
  handleEnvironments,
  handleCatalog,
  ...
];
```

- [ ] **Step 3: Typecheck and full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail** (no new tests; backend-only change, no regressions).

- [ ] **Step 4: Smoke-test the route with curl**

Start the server in one shell:
```bash
./bun.exe run launch
```

In a second shell, exercise the route end-to-end:
```bash
curl -s http://localhost:5757/api/environments
# Expected: {"envs":[],"activeId":null}

curl -s -X POST http://localhost:5757/api/environments \
  -H 'content-type: application/json' \
  -d '{"name":"test","baseUrl":"https://integrate.elluciancloud.com","production":false,"defaultHeaders":{},"apiKey":"dummy"}'
# Expected: 201 with the created env (no apiKey in body)

curl -s http://localhost:5757/api/environments
# Expected: the env appears with hasApiKey:true
```

If any step returns a 500 or unexpected shape, stop and debug before moving on. Clean up test data before the UI tasks: `rm "$APPDATA/api-catalog-explorer/environments.json"` and the paired entry in `secrets.json` (or delete the whole `secrets.json` — the DPAPI tests don't depend on its contents).

Stop the server.

---

## Task 9: Frontend — App.svelte route variant, env state, and fetch on mount

**Files:**
- Modify: `web/App.svelte`

- [ ] **Step 1: Add the `Environment` type and route variant**

In `web/App.svelte`, near the other type declarations at the top of the `<script>`, add:

```ts
type Environment = {
  id: string;
  name: string;
  baseUrl: string;
  authUrl?: string;
  production: boolean;
  defaultHeaders: Record<string, string>;
  hasApiKey: boolean;
};
```

Then widen the existing `Route` union from:

```ts
  type Route =
    | { kind: "overview" }
    | { kind: "api"; family: string; resource: string; version?: string }
    | { kind: "column"; name: string }
    | { kind: "table"; name: string };
```

to:

```ts
  type Route =
    | { kind: "overview" }
    | { kind: "api"; family: string; resource: string; version?: string }
    | { kind: "column"; name: string }
    | { kind: "table"; name: string }
    | { kind: "settings"; section: "environments" };
```

- [ ] **Step 2: Update `routeToPath` and `pathToRoute`**

Add the `settings` branch to both functions. `routeToPath`:

```ts
      case "settings":
        return `/settings/${r.section}`;
```

`pathToRoute` — add above the final `return { kind: "overview" };` fallback:

```ts
    if (head === "settings") {
      // Bare /settings redirects to /settings/environments (the default section).
      const section = rest[0] ?? "environments";
      if (section === "environments") return { kind: "settings", section };
    }
```

- [ ] **Step 3: Add env state and a navigation helper**

Near the other `$state` declarations:

```ts
  let envs = $state<Environment[] | null>(null);
  let activeEnvId = $state<string | null>(null);
```

Add a small function, near the other `select*`/`goOverview` helpers:

```ts
  function goSettings() {
    navigate({ kind: "settings", section: "environments" });
  }
```

- [ ] **Step 4: Fetch environments on mount — extend `loadAll()`**

In `App.svelte` there's an existing `async function loadAll()` called from `$effect(() => { ... loadAll(); ... })`. Its current shape parallel-fetches `/api/status` and `/api/config`. Extend the `Promise.all` tuple to include `/api/environments`:

Before:
```ts
      const [statusRes, configRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/config"),
      ]);
      if (statusRes.ok) serverVersion = ((await statusRes.json()) as { version?: string }).version;
      if (configRes.ok) config = (await configRes.json()) as AppConfig;
```
After:
```ts
      const [statusRes, configRes, envsRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/config"),
        fetch("/api/environments"),
      ]);
      if (statusRes.ok) serverVersion = ((await statusRes.json()) as { version?: string }).version;
      if (configRes.ok) config = (await configRes.json()) as AppConfig;
      if (envsRes.ok) {
        const data = (await envsRes.json()) as { envs: Environment[]; activeId: string | null };
        envs = data.envs;
        activeEnvId = data.activeId;
      }
```

No other changes to `loadAll()` — it already handles errors by setting `loadError` and returning.

- [ ] **Step 5: Compute resolved active env name for TopBar and StatusBar**

Add a `$derived` value:

```ts
  const activeEnvName = $derived(
    envs && activeEnvId ? (envs.find((e) => e.id === activeEnvId)?.name ?? "(none)") : "(none)",
  );
  const activeEnv = $derived(envs && activeEnvId ? (envs.find((e) => e.id === activeEnvId) ?? null) : null);
```

Then pass `activeEnvName` into `<StatusBar env={...} />` (replacing whatever the current placeholder is) and keep `activeEnv` available for the TopBar red-dot logic in Task 12.

- [ ] **Step 6: Route the `settings` view in the template**

In the part of `App.svelte` that renders the current `Route` — a sequence of `{#if route.kind === "..."}` blocks — add a new block:

```svelte
  {:else if route.kind === "settings"}
    <SettingsView
      section={route.section}
      envs={envs ?? []}
      activeEnvId={activeEnvId}
      onChange={(nextEnvs, nextActiveId) => {
        envs = nextEnvs;
        activeEnvId = nextActiveId;
      }}
    />
```

Import at the top:

```ts
  import SettingsView from "./settings/SettingsView.svelte";
```

(`SettingsView.svelte` will exist after Task 10 — leaving this import in place means typecheck fails transiently until Task 10 ships. If you want clean typecheck at the end of this task, add an empty stub file now: `web/settings/SettingsView.svelte` containing just `<script lang="ts">let props = $props();</script>`. Task 10 overwrites it.)

- [ ] **Step 7: Create the temporary stub for SettingsView**

Write `web/settings/SettingsView.svelte`:

```svelte
<script lang="ts">
  // Stub for typecheck; real implementation lands in Task 10.
  let props = $props();
  void props;
</script>
```

- [ ] **Step 8: Verify**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail**. (No new tests; UI is manually verified at the end.)

---

## Task 10: Frontend — SettingsView shell + read-only EnvironmentsPanel list

**Files:**
- Overwrite: `web/settings/SettingsView.svelte`
- Create: `web/settings/EnvironmentsPanel.svelte`

- [ ] **Step 1: Write `web/settings/SettingsView.svelte`**

```svelte
<script lang="ts">
  import EnvironmentsPanel from "./EnvironmentsPanel.svelte";

  type Environment = {
    id: string;
    name: string;
    baseUrl: string;
    authUrl?: string;
    production: boolean;
    defaultHeaders: Record<string, string>;
    hasApiKey: boolean;
  };

  type Props = {
    section: "environments";
    envs: Environment[];
    activeEnvId: string | null;
    onChange: (envs: Environment[], activeEnvId: string | null) => void;
  };
  let { section, envs, activeEnvId, onChange }: Props = $props();
</script>

<div class="settings-view">
  <h1 class="settings-title">Settings</h1>
  {#if section === "environments"}
    <EnvironmentsPanel {envs} {activeEnvId} {onChange} />
  {/if}
</div>

<style>
  .settings-view {
    padding: var(--space-5) var(--space-6);
    max-width: 900px;
    margin: 0 auto;
    color: var(--fg);
    font-family: var(--font-mono);
  }
  .settings-title {
    font-size: 1.5rem;
    color: var(--fg-bright);
    margin: 0 0 var(--space-5) 0;
    font-weight: 600;
  }
</style>
```

- [ ] **Step 2: Write `web/settings/EnvironmentsPanel.svelte` — list view only**

Read-only version first; add/edit/delete arrive in Tasks 11–12.

```svelte
<script lang="ts">
  type Environment = {
    id: string;
    name: string;
    baseUrl: string;
    authUrl?: string;
    production: boolean;
    defaultHeaders: Record<string, string>;
    hasApiKey: boolean;
  };

  type Props = {
    envs: Environment[];
    activeEnvId: string | null;
    onChange: (envs: Environment[], activeEnvId: string | null) => void;
  };
  let { envs, activeEnvId }: Props = $props();
</script>

<section class="envs-panel">
  <header class="envs-header">
    <h2>Environments ({envs.length})</h2>
    <button class="btn-primary" disabled>+ Add environment</button>
  </header>

  {#if envs.length === 0}
    <div class="empty-state">
      <p>No environments yet.</p>
    </div>
  {:else}
    <ul class="envs-list">
      {#each envs as env (env.id)}
        <li class="env-row" class:active={env.id === activeEnvId}>
          <div class="env-meta">
            <span class="env-name">{env.name}</span>
            {#if env.production}<span class="badge badge-prod">PROD</span>{/if}
            {#if env.id === activeEnvId}<span class="badge badge-active">active</span>{/if}
            {#if !env.hasApiKey}<span class="hint-nokey" title="API key not set">•</span>{/if}
          </div>
          <div class="env-actions">
            <button disabled>Activate</button>
            <button disabled>Edit</button>
            <button disabled>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .envs-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .envs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .envs-header h2 {
    font-size: 1.1rem;
    margin: 0;
    color: var(--fg);
  }
  .btn-primary {
    background: var(--bg-raised);
    color: var(--fg-bright);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) { background: var(--bg-panel); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .empty-state {
    padding: var(--space-6);
    text-align: center;
    color: var(--fg-dim);
    border: 1px dashed var(--border);
  }

  .envs-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .env-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-panel);
    border: 1px solid var(--border);
  }
  .env-row.active {
    border-color: var(--accent-active);
  }
  .env-meta { display: flex; align-items: center; gap: var(--space-3); }
  .env-name { font-weight: 600; color: var(--fg-bright); }
  .badge {
    display: inline-block;
    padding: 0 var(--space-2);
    font-size: 0.75rem;
    border-radius: 2px;
    font-weight: 600;
  }
  .badge-prod { background: var(--danger); color: var(--bg); }
  .badge-active { background: var(--accent-active); color: var(--bg); }
  .hint-nokey { color: var(--warn); font-size: 1.2rem; }

  .env-actions { display: flex; gap: var(--space-2); }
  .env-actions button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .env-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .env-actions button:hover:not(:disabled) { background: var(--bg-raised); }
</style>
```

- [ ] **Step 3: Verify typecheck and full suite**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail**.

- [ ] **Step 4: Manual smoke-test**

Start the dev stack (in two shells):
```bash
./bun.exe run dev          # shell 1 — backend
./bun.exe run dev:web      # shell 2 — vite dev server
```

Visit the Vite dev URL (typically `http://localhost:5173`), then manually navigate to `/settings/environments` via the URL bar. You should see:
- `Settings` title
- `Environments (0)` with the disabled `+ Add environment` button
- Empty-state message "No environments yet."

Also confirm nothing else broke — the overview route still loads.

Stop the servers.

---

## Task 11: Frontend — Add / Edit / Delete / Activate (EnvironmentsPanel full CRUD)

**Files:**
- Modify: `web/settings/EnvironmentsPanel.svelte`

This is the largest single task — replacing the read-only panel with the full CRUD UI. Size estimate: roughly 300 lines after.

- [ ] **Step 1: Rewrite `web/settings/EnvironmentsPanel.svelte` with the full form**

```svelte
<script lang="ts">
  type Environment = {
    id: string;
    name: string;
    baseUrl: string;
    authUrl?: string;
    production: boolean;
    defaultHeaders: Record<string, string>;
    hasApiKey: boolean;
  };

  type Props = {
    envs: Environment[];
    activeEnvId: string | null;
    onChange: (envs: Environment[], activeEnvId: string | null) => void;
  };
  let { envs, activeEnvId, onChange }: Props = $props();

  // Edit state: null = read-only, "new" = adding, <id> = editing that env.
  let editing = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let submitting = $state(false);

  // Buffered form fields (kept separate so Cancel is trivial).
  let fName = $state("");
  let fBaseUrl = $state("");
  let fAuthUrl = $state("");
  let fProduction = $state(false);
  let fApiKey = $state("");
  // Default headers as an array of [key, value] pairs for the editor.
  let fHeaders = $state<Array<{ k: string; v: string }>>([]);

  function startAdd() {
    if (editing !== null && !confirm("Discard unsaved changes?")) return;
    editing = "new";
    fName = "";
    fBaseUrl = "";
    fAuthUrl = "";
    fProduction = false;
    fApiKey = "";
    fHeaders = [];
    formError = null;
  }

  function startEdit(env: Environment) {
    if (editing !== null && editing !== env.id && !confirm("Discard unsaved changes?")) return;
    editing = env.id;
    fName = env.name;
    fBaseUrl = env.baseUrl;
    fAuthUrl = env.authUrl ?? "";
    fProduction = env.production;
    fApiKey = ""; // blank → leave-unchanged on edit
    fHeaders = Object.entries(env.defaultHeaders).map(([k, v]) => ({ k, v }));
    formError = null;
  }

  function cancelEdit() {
    editing = null;
    formError = null;
  }

  function addHeader() { fHeaders = [...fHeaders, { k: "", v: "" }]; }
  function removeHeader(i: number) { fHeaders = fHeaders.filter((_, idx) => idx !== i); }

  function headersFromForm(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { k, v } of fHeaders) {
      const key = k.trim();
      if (key) out[key] = v;
    }
    return out;
  }

  async function save() {
    formError = null;
    submitting = true;
    try {
      if (editing === "new") {
        const res = await fetch("/api/environments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: fName,
            baseUrl: fBaseUrl,
            authUrl: fAuthUrl.trim() === "" ? undefined : fAuthUrl.trim(),
            production: fProduction,
            defaultHeaders: headersFromForm(),
            apiKey: fApiKey,
          }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const created = (await res.json()) as Environment;
        onChange([...envs, created], activeEnvId);
      } else if (editing !== null) {
        const id = editing;
        const body: Record<string, unknown> = {
          name: fName,
          baseUrl: fBaseUrl,
          authUrl: fAuthUrl.trim() === "" ? null : fAuthUrl.trim(),
          production: fProduction,
          defaultHeaders: headersFromForm(),
        };
        if (fApiKey !== "") body.apiKey = fApiKey;
        const res = await fetch(`/api/environments/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const updated = (await res.json()) as Environment;
        onChange(envs.map((e) => (e.id === id ? updated : e)), activeEnvId);
      }
      editing = null;
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function doDelete(env: Environment) {
    if (!confirm(`Delete environment "${env.name}"? This also deletes its API key.`)) return;
    const res = await fetch(`/api/environments/${encodeURIComponent(env.id)}`, { method: "DELETE" });
    if (!res.ok) {
      alert(await errorText(res));
      return;
    }
    const nextEnvs = envs.filter((e) => e.id !== env.id);
    const nextActive = activeEnvId === env.id ? null : activeEnvId;
    onChange(nextEnvs, nextActive);
  }

  async function doActivate(env: Environment) {
    const res = await fetch(`/api/environments/${encodeURIComponent(env.id)}/activate`, { method: "POST" });
    if (!res.ok) {
      alert(await errorText(res));
      return;
    }
    onChange(envs, env.id);
  }

  async function errorText(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
</script>

<section class="envs-panel">
  <header class="envs-header">
    <h2>Environments ({envs.length})</h2>
    <button class="btn-primary" onclick={startAdd} disabled={editing !== null}>
      + Add environment
    </button>
  </header>

  {#if envs.length === 0 && editing !== "new"}
    <div class="empty-state">
      <p>No environments yet.</p>
      <button class="btn-primary" onclick={startAdd}>+ Add environment</button>
    </div>
  {/if}

  <ul class="envs-list">
    {#if editing === "new"}
      <li class="env-row editing">
        <header class="env-meta">
          <span class="env-name">New environment</span>
          <button class="btn-link" onclick={cancelEdit}>Cancel</button>
        </header>
        {@render form()}
      </li>
    {/if}

    {#each envs as env (env.id)}
      <li class="env-row" class:active={env.id === activeEnvId} class:editing={editing === env.id}>
        <div class="env-row-top">
          <div class="env-meta">
            <span class="env-name">{env.name}</span>
            {#if env.production}<span class="badge badge-prod">PROD</span>{/if}
            {#if env.id === activeEnvId}<span class="badge badge-active">active</span>{/if}
            {#if !env.hasApiKey}<span class="hint-nokey" title="API key not set">•</span>{/if}
          </div>
          <div class="env-actions">
            {#if env.id !== activeEnvId}
              <button onclick={() => doActivate(env)} disabled={editing !== null}>Activate</button>
            {/if}
            <button onclick={() => startEdit(env)} disabled={editing !== null && editing !== env.id}>
              {editing === env.id ? "Editing…" : "Edit"}
            </button>
            <button onclick={() => doDelete(env)} disabled={editing !== null}>Delete</button>
          </div>
        </div>
        {#if editing === env.id}
          {@render form()}
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet form()}
    <div class="form-grid">
      <label>
        <span>Name</span>
        <input type="text" bind:value={fName} placeholder="e.g. apply-prod" />
      </label>
      <label>
        <span>Base URL</span>
        <input type="url" bind:value={fBaseUrl} placeholder="https://integrate.elluciancloud.com" />
      </label>
      <label>
        <span>Auth URL <span class="muted">(optional override)</span></span>
        <input type="url" bind:value={fAuthUrl} placeholder="default: {fBaseUrl || '<baseUrl>'}/auth" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={fProduction} />
        <span>Production</span>
      </label>
      <label>
        <span>API key</span>
        <input
          type="password"
          bind:value={fApiKey}
          placeholder={editing !== "new" && envs.find((e) => e.id === editing)?.hasApiKey
            ? "•••••••• (leave blank to keep)"
            : "required"}
        />
      </label>

      <div class="headers-editor">
        <span class="headers-label">Default headers</span>
        {#each fHeaders as header, i (i)}
          <div class="header-row">
            <input type="text" bind:value={header.k} placeholder="header name" />
            <input type="text" bind:value={header.v} placeholder="value" />
            <button type="button" onclick={() => removeHeader(i)} aria-label="Remove header">✕</button>
          </div>
        {/each}
        <button type="button" class="btn-link" onclick={addHeader}>+ Add header</button>
      </div>

      {#if formError}
        <p class="form-error">{formError}</p>
      {/if}

      <div class="form-actions">
        <button class="btn-primary" onclick={save} disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
        <button class="btn-link" onclick={cancelEdit} disabled={submitting}>Cancel</button>
      </div>
    </div>
  {/snippet}
</section>

<style>
  .envs-panel { display: flex; flex-direction: column; gap: var(--space-4); }
  .envs-header { display: flex; align-items: center; justify-content: space-between; }
  .envs-header h2 { font-size: 1.1rem; margin: 0; color: var(--fg); }

  .btn-primary {
    background: var(--bg-raised);
    color: var(--fg-bright);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) { background: var(--bg-panel); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-link {
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    text-decoration: underline;
  }
  .btn-link:hover:not(:disabled) { color: var(--fg); }

  .empty-state {
    padding: var(--space-6);
    text-align: center;
    color: var(--fg-dim);
    border: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .envs-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }

  .env-row {
    padding: var(--space-3) var(--space-4);
    background: var(--bg-panel);
    border: 1px solid var(--border);
  }
  .env-row.active { border-color: var(--accent-active); }
  .env-row.editing { border-color: var(--border-strong); }

  .env-row-top { display: flex; align-items: center; justify-content: space-between; }
  .env-meta { display: flex; align-items: center; gap: var(--space-3); }
  .env-name { font-weight: 600; color: var(--fg-bright); }
  .badge {
    display: inline-block;
    padding: 0 var(--space-2);
    font-size: 0.75rem;
    border-radius: 2px;
    font-weight: 600;
  }
  .badge-prod { background: var(--danger); color: var(--bg); }
  .badge-active { background: var(--accent-active); color: var(--bg); }
  .hint-nokey { color: var(--warn); font-size: 1.2rem; }

  .env-actions { display: flex; gap: var(--space-2); }
  .env-actions button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .env-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .env-actions button:hover:not(:disabled) { background: var(--bg-raised); }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) 0 0 0;
    border-top: 1px solid var(--border);
    margin-top: var(--space-3);
  }
  .form-grid label { display: flex; flex-direction: column; gap: var(--space-1); font-size: 0.9rem; }
  .form-grid label > span { color: var(--fg-dim); }
  .form-grid input[type="text"],
  .form-grid input[type="url"],
  .form-grid input[type="password"] {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: 0.95rem;
  }
  .form-grid input:focus { outline: 1px solid var(--border-strong); }
  .checkbox-label { flex-direction: row !important; align-items: center; gap: var(--space-2); }
  .muted { color: var(--fg-dim); }

  .headers-editor { display: flex; flex-direction: column; gap: var(--space-2); }
  .headers-label { color: var(--fg-dim); font-size: 0.9rem; }
  .header-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: var(--space-2); }
  .header-row input { background: var(--bg); color: var(--fg); border: 1px solid var(--border); padding: var(--space-1) var(--space-2); font-family: var(--font-mono); }
  .header-row button { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); cursor: pointer; }

  .form-error {
    color: var(--danger);
    background: var(--bg);
    border: 1px solid var(--danger);
    padding: var(--space-2) var(--space-3);
    margin: 0;
  }
  .form-actions { display: flex; gap: var(--space-3); align-items: center; }
</style>
```

- [ ] **Step 2: Verify typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke test**

Start the stack (`./bun.exe run dev` + `./bun.exe run dev:web`). Navigate to `/settings/environments`. Exercise:

1. Click `+ Add environment`. Fill in `name=test`, `baseUrl=https://integrate.elluciancloud.com`, `apiKey=dummy`. Save.
2. Confirm the row appears with `active` **not** set (we haven't wired Activate in UI yet — the backend route works; clicking Activate should flip the badge).
3. Click `Activate` on the new row. Confirm the `active` green badge appears.
4. Click `Edit`. Change `name=test2`. Save. Confirm the new name appears.
5. Click `Delete`. Confirm browser dialog. Confirm row disappears.
6. Confirm `+ Add environment` is re-enabled.
7. Trigger an error: add an env, then try to add another with the same name. Expect an inline error under the form, not a crash.

Stop the servers. Don't bother re-checking themes yet — that's Task 14.

---

## Task 12: Frontend — TopBar selector wiring, gear icon, StatusBar

**Files:**
- Modify: `web/shell/TopBar.svelte`
- Modify: `web/shell/StatusBar.svelte` (trivial)
- Modify: `web/App.svelte` (pass envs/activeId/callbacks into TopBar)

**Scope note:** no CommandPalette edit — see the "Scope note on the command palette" at the top of this plan. The gear icon in the TopBar is the primary Settings entry point; users can also type `/settings/environments` in the URL bar or bookmark.

- [ ] **Step 1: Update `web/shell/TopBar.svelte`**

Change the `Props` type and selector logic. Replace the file with:

```svelte
<script lang="ts">
  type Environment = {
    id: string;
    name: string;
    production: boolean;
  };
  type ThemeName = "phosphor" | "amber" | "dos" | "beige";

  type Props = {
    theme: ThemeName;
    onthemechange: (t: ThemeName) => void;
    envs: Environment[];
    activeEnvId: string | null;
    onactivate: (id: string) => void;
    onopensettings: () => void;
    openCommandPalette: () => void;
  };
  let { theme, onthemechange, envs, activeEnvId, onactivate, onopensettings, openCommandPalette }: Props = $props();

  const themes: ThemeName[] = ["phosphor", "amber", "dos", "beige"];

  const activeEnv = $derived(envs.find((e) => e.id === activeEnvId) ?? null);

  function onSelectChange(ev: Event) {
    const value = (ev.target as HTMLSelectElement).value;
    if (value && value !== activeEnvId) onactivate(value);
  }
</script>

<header class="top-bar">
  <button class="search-trigger" onclick={openCommandPalette} aria-label="Open search (Ctrl+K)">
    <span class="icon">⌕</span>
    <span class="placeholder">search APIs, columns, tables, domains…</span>
    <span class="hint">Ctrl+K</span>
  </button>

  <div class="right-controls">
    <div class="env-selector">
      <span class="dot" class:prod={activeEnv?.production === true}></span>
      <span class="label">env</span>
      <select value={activeEnvId ?? ""} onchange={onSelectChange} disabled={envs.length === 0}>
        <option value="" disabled>{envs.length === 0 ? "(none)" : "— select —"}</option>
        {#each envs as env (env.id)}
          <option value={env.id}>{env.name}{env.production ? " (PROD)" : ""}</option>
        {/each}
      </select>
    </div>

    <button class="gear" onclick={onopensettings} aria-label="Open settings" title="Settings">⚙</button>

    <div class="theme-selector" aria-label="theme">
      {#each themes as t (t)}
        <button class:active={theme === t} onclick={() => onthemechange(t)}>{t}</button>
      {/each}
    </div>
  </div>
</header>

<style>
  .top-bar { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-2) var(--space-4); background: var(--bg-panel); border-bottom: 1px solid var(--border); }
  .search-trigger { flex: 1; display: flex; align-items: center; gap: var(--space-3); background: var(--bg); color: var(--fg-dim); border: 1px solid var(--border); padding: var(--space-2) var(--space-3); font-family: var(--font-mono); cursor: pointer; text-align: left; }
  .search-trigger:hover { color: var(--fg); }
  .search-trigger .placeholder { flex: 1; }
  .search-trigger .hint { color: var(--fg-dim); font-size: 0.8rem; }

  .right-controls { display: flex; align-items: center; gap: var(--space-3); }

  .env-selector { display: flex; align-items: center; gap: var(--space-2); color: var(--fg-dim); font-family: var(--font-mono); font-size: 0.9rem; }
  .env-selector .dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--fg-dim); background: transparent; display: inline-block; }
  .env-selector .dot.prod { background: var(--danger); border-color: var(--danger); }
  .env-selector select { background: var(--bg); color: var(--fg); border: 1px solid var(--border); padding: var(--space-1) var(--space-2); font-family: var(--font-mono); }
  .env-selector select:disabled { opacity: 0.5; }

  .gear { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); padding: var(--space-1) var(--space-3); font-family: var(--font-mono); font-size: 1rem; cursor: pointer; }
  .gear:hover { color: var(--fg-bright); background: var(--bg-raised); }

  .theme-selector { display: flex; gap: 1px; }
  .theme-selector button { background: var(--bg); color: var(--fg-dim); border: 1px solid var(--border); padding: var(--space-1) var(--space-2); font-family: var(--font-mono); font-size: 0.85rem; cursor: pointer; }
  .theme-selector button.active { color: var(--fg-bright); background: var(--bg-raised); }
</style>
```

- [ ] **Step 2: Update the `<TopBar>` usage in `web/App.svelte`**

Find the existing `<TopBar ... />` in the template and replace its props to pass `envs`, `activeEnvId`, `onactivate`, and `onopensettings`:

```svelte
  <TopBar
    {theme}
    onthemechange={(t) => { theme = t; localStorage.setItem(THEME_STORAGE, t); }}
    envs={envs ?? []}
    {activeEnvId}
    onactivate={async (id) => {
      const res = await fetch(`/api/environments/${encodeURIComponent(id)}/activate`, { method: "POST" });
      if (res.ok) activeEnvId = id;
    }}
    onopensettings={goSettings}
    openCommandPalette={() => (paletteOpen = true)}
  />
```

(Adapt to whatever the existing theme-change and palette-open handlers are named. Don't remove the existing `env` prop if it was being passed explicitly — just replace it with the new props.)

- [ ] **Step 3: Update `web/shell/StatusBar.svelte`**

The `env` prop is already a string; no structural change needed. Confirm `App.svelte` is now passing `activeEnvName` into it (from Task 9, Step 5).

- [ ] **Step 4: Typecheck**

Run: `./bun.exe run typecheck`
Expected: clean.

- [ ] **Step 5: Manual smoke**

Start the dev stack. Navigate to `/` (overview). Check:
- TopBar: env selector is disabled with `(none)` if no envs exist; shows the env list if any exist; the red dot lights up when the active env is production.
- Gear icon navigates to `/settings/environments`.
- Status bar `env:` reflects the active env name, or `(none)` when no env is active.
- Change active env via the TopBar selector: StatusBar updates immediately.

Stop servers.

---

## Task 13: Theme CSS — add `--accent-active` to every theme block

**Files:**
- Modify: `web/styles/theme.css`

- [ ] **Step 1: Add `--accent-active` to each theme's `:root[data-theme="..."]` block**

The file has blocks for `phosphor`, `amber`, `dos`, and `beige`. Add one variable to each. Per-theme suggested values (choose visually-appropriate greens/cyans/blues that pop against the theme bg but don't clash):

- `phosphor` (green theme): `--accent-active: #3affa0;`
- `amber` (amber theme): `--accent-active: #ffd700;`
- `dos` (blue theme): `--accent-active: #55ffff;`
- `beige` (warm paper): `--accent-active: #4b8f3a;`

Insert the line directly below each theme's `--accent` line. Example for phosphor (line ~19-20 in the current file):

Before:
```css
  --fg: #a9ff68;
  --fg-bright: #c9ff9a;
  --fg-dim: #6ba544;
  --accent: #e0ffd0;

  --danger: #ff6868;
```
After:
```css
  --fg: #a9ff68;
  --fg-bright: #c9ff9a;
  --fg-dim: #6ba544;
  --accent: #e0ffd0;
  --accent-active: #3affa0;

  --danger: #ff6868;
```

Repeat for amber, dos, beige with the values above. (`--danger` already exists on every theme and stays as-is — it's reused for the PROD badge and the red dot.)

- [ ] **Step 2: Typecheck and tests**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **80 pass / 0 fail**.

---

## Task 14: Manual browser verification across all four themes

This is the UI sign-off. No code changes — just a structured walkthrough to catch CSS regressions.

- [ ] **Step 1: Start the dev stack**

```bash
./bun.exe run dev         # shell 1
./bun.exe run dev:web     # shell 2
```

Visit `http://localhost:5173`.

- [ ] **Step 2: Golden path in phosphor theme (default)**

1. Switch to phosphor theme via the TopBar theme selector (it's usually the default).
2. Navigate to `/settings/environments` via the gear icon.
3. Click `+ Add environment`. Fill `name=test-a`, `baseUrl=https://integrate.elluciancloud.com`, `apiKey=dummy`. Save.
4. Confirm the row appears with no badges and the small `•` not-yet-keyed hint gone (we set apiKey).
5. Click `Activate`. Green `active` badge appears. StatusBar updates.
6. Click `Edit`, tick `Production`, save. Confirm red `PROD` badge appears; TopBar dot turns red.
7. Add a header `Accept` = `application/vnd.hedtech.integration.v13+json`. Save.
8. Refresh the page. Confirm state persists: active env still active, headers still present.
9. Delete the env. Confirm row disappears, StatusBar goes back to `env: (none)`, TopBar dot turns hollow, the selector becomes disabled / `(none)`.

- [ ] **Step 3: Validation errors**

1. Add an env. Then try to add another with the exact same name. Confirm the error appears inline below the form, not as a browser alert or a page crash.
2. Try a `baseUrl` of `not-a-url`. Confirm the error surfaces.
3. Cancel — the half-filled form goes away.
4. Delete the env you created. Clean up.

- [ ] **Step 4: Empty state**

Starting with zero envs: confirm the empty-state CTA ("No environments yet." + Add button) renders. Click the CTA's Add button (not the header one). Confirm form opens.

Cancel without saving. Confirm empty state re-renders.

- [ ] **Step 5: Repeat Steps 2–4 in each of the other three themes**

Switch theme (`amber`, then `dos`, then `beige`). For each theme:
- Navigate to `/settings/environments`.
- Add an env, activate it, toggle production, delete it.
- Scan for: clipped text, illegible colors, badges that blend into background, placeholders that vanish, focus rings that disappear.

Known visual checkpoints:
- `PROD` badge: must be clearly red-tinted on every theme.
- `active` badge: must be clearly distinct from `PROD`.
- The `•` "no key" hint: visible but not alarming.
- Form inputs: readable with sufficient contrast; focus state is apparent.
- Error message box: red border, readable.

- [ ] **Step 6: Final: clean up test data**

Close servers. Optionally remove `%APPDATA%\api-catalog-explorer\environments.json` and the paired entries in `secrets.json` so real use starts clean.

- [ ] **Step 7: Report findings**

If everything looked right in all four themes, mark the task done. If any theme showed regressions, fix them (add more CSS-variable fallbacks or adjust the values in Task 13) and re-verify only the affected path.

---

## Task 15: PLAN.md cleanup

**Files:**
- Modify: `PLAN.md` (5 edits)

- [ ] **Step 1: Verify the target lines still contain the expected text**

Run:
```bash
grep -n "safety settings (confirm, dry-run, body redaction)" PLAN.md
grep -n "OAuth2 Client Credentials (Ethos)" PLAN.md
grep -n "Secondary: Direct bearer token" PLAN.md
grep -n "src/routes/settings" PLAN.md
grep -n "Environment profile manager (Settings → Environments)" PLAN.md
```

Each should return one or two matches. If any return zero, the text has drifted — inspect the file before proceeding.

- [ ] **Step 2: Fix the vestigial "safety settings" phrase (L244-ish)**

Replace:
```
- **Per-profile fields**: name, server URL (region), auth config, production flag, default headers, safety settings (confirm, dry-run, body redaction).
```
with:
```
- **Per-profile fields**: name, server URL (region), auth config (Ellucian API key), production flag, default headers. The `production` flag is the sole safety setting — when true, the Try panel confirms non-GET requests; the request-history logger always redacts bodies regardless of env.
```

- [ ] **Step 3: Fix the auth-model description (L247-ish)**

Replace:
```
  - Primary: **OAuth2 Client Credentials (Ethos)** — server exchanges `client_id` + `client_secret` for bearer token at the tenant's auth URL, caches in RAM for TTL - 60 s, refreshes on 401, proxies calls with `Authorization: Bearer <token>` + configured `Accept: application/vnd.hedtech.integration.vN+json`.
```
with:
```
  - **Ellucian Ethos Integration auth** — server sends the tenant's API key as `Authorization: Bearer <api_key>` to the tenant's `/auth` endpoint (or configured `authUrl` override), receives a plaintext JWT in the response body, caches in RAM for TTL - 60 s, refreshes on 401, proxies calls with `Authorization: Bearer <jwt>` + configured `Accept: application/vnd.hedtech.integration.vN+json`. API key is required per env; there is no client_id/client_secret pair.
```

- [ ] **Step 4: Drop the secondary/tertiary auth modes (L248-L249-ish)**

Find the two lines:
```
  - Secondary: Direct bearer token (manual testing).
  - Tertiary: Custom-header auth (tenant quirks).
```
and delete them entirely. They're not supported in MVP; the API-key mode is the only mode. If future auth modes are needed, the env-profile spec's "Extensibility" section documents the migration path.

- [ ] **Step 5: Fix the frontend path reference (L403-ish)**

Replace:
```
  - `src/routes/settings/+page.svelte` — environments, catalog, appearance.
```
with:
```
  - `web/settings/SettingsView.svelte` — section-aware Settings shell (environments, later catalog and appearance).
  - `web/settings/EnvironmentsPanel.svelte` — CRUD for environment profiles.
```

- [ ] **Step 6: Expand Phase 2 item 1 (L505-ish)**

Replace:
```
1. **Environment profile manager** (Settings → Environments). CRUD UI backed by `%APPDATA%\api-catalog-explorer\environments.json`. Fields per profile: name, region server URL, auth config, production flag, default headers, verb-safety toggles.
```
with:
```
1. **Environment profile manager** (Settings → Environments, at `/settings/environments`). CRUD UI backed by `%APPDATA%\api-catalog-explorer\environments.json`; API keys stored DPAPI-encrypted in the sibling `secrets.json` under key `env/<id>/api_key`. Fields per profile: name, baseUrl, optional authUrl override, production flag, default headers. Top-bar env selector (populated, with a red dot indicator when the active env is production) switches active env in one click; `activeId` persists across launches. Settings accessed via a gear icon in the top bar or by navigating directly to `/settings/environments`.
```

- [ ] **Step 7: Verify**

Run:
```bash
grep -n "safety settings (confirm" PLAN.md
grep -n "OAuth2 Client Credentials" PLAN.md
grep -n "Secondary: Direct bearer" PLAN.md
grep -n "Tertiary: Custom-header" PLAN.md
grep -n "src/routes/settings" PLAN.md
grep -n "verb-safety toggles" PLAN.md
```
Expected: **no results for any of these**.

Then:
```bash
./bun.exe run typecheck && ./bun.exe test
```
Expected: clean typecheck, **80 pass / 0 fail** (pure docs change — nothing should have moved).

---

## Done condition

After Task 15:
- `server/environments/store.ts` exists and passes 26 store-level tests.
- `server/routes/environments.ts` exists and is registered in the dispatcher.
- Full test suite: **80 pass / 0 fail**, typecheck clean.
- `web/settings/SettingsView.svelte` and `web/settings/EnvironmentsPanel.svelte` exist.
- `TopBar.svelte` has a real env selector + red dot indicator + gear icon.
- `StatusBar.svelte` shows the active env name.
- `theme.css` has `--accent-active` defined for all four themes.
- `PLAN.md` no longer mentions OAuth2 Client Credentials, secondary/tertiary auth modes, `src/routes/settings`, or the vestigial safety-settings triple.
- The feature has been manually verified across all four themes.
- The env-profile module is ready to be consumed by the next Phase 2 task (token exchange + proxy).
