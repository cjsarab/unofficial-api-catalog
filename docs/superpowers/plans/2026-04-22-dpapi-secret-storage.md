# DPAPI Secret Storage Implementation Plan

> **Obsolete — DPAPI was removed in the 2026-05-01 pivot.** Secrets now live plaintext in `./data/secrets.json` (gitignored, single-user localhost trust model). Plan preserved as historical record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windows DPAPI-backed secret storage so Phase 2's OAuth client_secret values can persist across launches without plaintext-on-disk.

**Architecture:** Two-layer split. `server/auth/dpapi.ts` is a thin `bun:ffi` wrapper around `CryptProtectData`/`CryptUnprotectData` from `crypt32.dll` — pure protect/unprotect with no I/O. `server/auth/secrets.ts` is a generic key/value store on top, persisting base64'd ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` via atomic tmp+rename writes. Future env-profile code calls the store, not the FFI primitives directly.

**Tech Stack:** Bun, TypeScript (strict + verbatimModuleSyntax), `bun:ffi`, `bun:test`, node:fs (sync), Win32 (`crypt32.dll`, `kernel32.dll`).

**Spec:** `docs/superpowers/specs/2026-04-22-dpapi-design.md`

**Repo state:** This project is **not** a git repo, so the plan does not include `git commit` steps. Each task ends with a `Verify` step (typecheck + tests). Treat each completed task as a logical checkpoint — if the user later runs `git init`, the per-task boundaries make natural commits.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `server/config.ts` | Modify | Add `SECRETS_PATH` constant alongside existing `ENVIRONMENTS_PATH` |
| `server/auth/dpapi.ts` | Create (~80 lines) | FFI primitives: `protect(string) → Buffer`, `unprotect(Buffer) → string`. No file I/O. |
| `server/auth/secrets.ts` | Create (~80 lines) | Factory `createSecretStore(filePath)` returning the four-method API. Atomic JSON persistence. |
| `tests/secrets.test.ts` | Create (7 tests) | End-to-end tests using a temp file per test (also covers DPAPI implicitly). |
| `PLAN.md` | Modify (5 lines + 1 paragraph) | Replace stale "Credential Manager" mentions with explicit DPAPI framing; add architecture note in Phase 2 section. |

**Note on the spec → plan API revision:** the spec showed module-level functions (`setSecret(key, value)` etc.). For test isolation we need a configurable file path. The cleanest fit is a factory that returns the API:

```ts
export interface SecretStore {
  setSecret(key: string, value: string): void;
  getSecret(key: string): string | null;
  deleteSecret(key: string): void;
  listSecretKeys(): string[];
}
export function createSecretStore(filePath: string): SecretStore;
```

Production callers do `createSecretStore(SECRETS_PATH)` once at boot; tests do `createSecretStore(tempPath)`. This is a tiny API change from the spec but materially the same semantics.

---

## Task 1: Add `SECRETS_PATH` constant

**Files:**
- Modify: `server/config.ts`

- [ ] **Step 1: Add the constant**

In `server/config.ts`, add `SECRETS_PATH` directly after `ENVIRONMENTS_PATH`:

```ts
export const ENVIRONMENTS_PATH = join(APP_DATA_DIR, "environments.json");
export const SECRETS_PATH = join(APP_DATA_DIR, "secrets.json");
```

(The line `ENVIRONMENTS_PATH` already exists — add `SECRETS_PATH` immediately below it.)

- [ ] **Step 2: Verify**

Run: `./bun.exe run typecheck`
Expected: no output (clean exit code 0).

---

## Task 2: Implement DPAPI FFI primitives

**Files:**
- Create: `server/auth/dpapi.ts`

The spec deliberately doesn't have a standalone `tests/dpapi.test.ts` — the FFI layer is tested implicitly through `secrets.ts` in Tasks 3–5. We use a one-off manual smoke test here to confirm the FFI bindings actually work *before* layering `secrets.ts` on top, so any bugs in the FFI layer surface with a single suspect rather than two.

- [ ] **Step 1: Write `server/auth/dpapi.ts`**

```ts
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";

// Win32 DPAPI bindings. CryptProtectData / CryptUnprotectData encrypt/decrypt
// arbitrary blobs tied to the current Windows user account — the ciphertext is
// useless on any other machine or user account.
//
// MSDN signatures (BLOB pointers in/out, all other args nullable for our usage):
//   BOOL CryptProtectData(
//     DATA_BLOB *pDataIn, LPCWSTR szDataDescr, DATA_BLOB *pOptionalEntropy,
//     PVOID pvReserved, CRYPTPROTECT_PROMPTSTRUCT *pPromptStruct,
//     DWORD dwFlags, DATA_BLOB *pDataOut);
//   BOOL CryptUnprotectData(...identical shape...);
//
// DATA_BLOB layout on x64: { DWORD cbData; BYTE *pbData; } → 16 bytes
// (4-byte cbData + 4 bytes padding + 8-byte pointer).
const BLOB_SIZE = 16;

const crypt32 = dlopen("crypt32.dll", {
  CryptProtectData: {
    args: [
      FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr,
      FFIType.ptr, FFIType.u32, FFIType.ptr,
    ],
    returns: FFIType.bool,
  },
  CryptUnprotectData: {
    args: [
      FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr,
      FFIType.ptr, FFIType.u32, FFIType.ptr,
    ],
    returns: FFIType.bool,
  },
});

const kernel32 = dlopen("kernel32.dll", {
  // Output blob's pbData is allocated by Windows; we must LocalFree it after copy.
  LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
  GetLastError: { args: [], returns: FFIType.u32 },
});

function makeBlob(data: Uint8Array): Buffer {
  const blob = Buffer.alloc(BLOB_SIZE);
  blob.writeUInt32LE(data.byteLength, 0);
  blob.writeBigUInt64LE(BigInt(ptr(data)), 8);
  return blob;
}

function readBlob(blob: Buffer): Uint8Array {
  const cbData = blob.readUInt32LE(0);
  const pbData = Number(blob.readBigUInt64LE(8));
  // Copy out of foreign memory before LocalFree.
  return new Uint8Array(toArrayBuffer(pbData, 0, cbData).slice(0));
}

export function protect(plaintext: string): Buffer {
  const inputBytes = Buffer.from(plaintext, "utf8");
  const inBlob = makeBlob(inputBytes);
  const outBlob = Buffer.alloc(BLOB_SIZE);

  const ok = crypt32.symbols.CryptProtectData(
    ptr(inBlob), null, null, null, null, 0, ptr(outBlob),
  );
  if (!ok) {
    const err = kernel32.symbols.GetLastError();
    throw new Error(`CryptProtectData failed: Win32 error ${err}`);
  }

  const result = readBlob(outBlob);
  kernel32.symbols.LocalFree(Number(outBlob.readBigUInt64LE(8)));
  return Buffer.from(result);
}

export function unprotect(ciphertext: Buffer): string {
  const inBlob = makeBlob(ciphertext);
  const outBlob = Buffer.alloc(BLOB_SIZE);

  const ok = crypt32.symbols.CryptUnprotectData(
    ptr(inBlob), null, null, null, null, 0, ptr(outBlob),
  );
  if (!ok) {
    const err = kernel32.symbols.GetLastError();
    throw new Error(`CryptUnprotectData failed: Win32 error ${err}`);
  }

  const result = readBlob(outBlob);
  kernel32.symbols.LocalFree(Number(outBlob.readBigUInt64LE(8)));
  return Buffer.from(result).toString("utf8");
}
```

- [ ] **Step 2: Manually smoke-test the FFI bindings**

Run:
```bash
./bun.exe -e "import { protect, unprotect } from './server/auth/dpapi.ts'; const c = protect('hello world'); console.log('cipher bytes:', c.length); console.log('round-trip:', unprotect(c));"
```
Expected output (cipher length will vary — DPAPI overhead is roughly 200–300 bytes):
```
cipher bytes: 234
round-trip: hello world
```
If you see `CryptProtectData failed: Win32 error <N>` instead, the FFI bindings are broken — debug *before* moving on. (Common causes: wrong arg type, wrong DLL name, missing struct alignment.)

- [ ] **Step 3: Verify**

Run: `./bun.exe run typecheck`
Expected: clean exit. (Existing 47 tests still pass since this file isn't imported anywhere yet.)

---

## Task 3: Write the failing round-trip test

**Files:**
- Create: `tests/secrets.test.ts`

- [ ] **Step 1: Create the test file with the first test only**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `./bun.exe test tests/secrets.test.ts`
Expected: a resolution failure pointing at `../server/auth/secrets.ts` — something like `error: Cannot find module '../server/auth/secrets.ts'` or similar. The failure must be about the missing module, NOT about the test itself; if it's about the test, fix the test before implementing.

---

## Task 4: Implement `secrets.ts` to make the round-trip test pass

**Files:**
- Create: `server/auth/secrets.ts`

- [ ] **Step 1: Write `server/auth/secrets.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { protect, unprotect } from "./dpapi.ts";

export interface SecretStore {
  setSecret(key: string, value: string): void;
  getSecret(key: string): string | null;
  deleteSecret(key: string): void;
  listSecretKeys(): string[];
}

// On-disk shape: { "<caller-chosen key>": "<base64 DPAPI ciphertext>" }
type SecretMap = Record<string, string>;

export function createSecretStore(filePath: string): SecretStore {
  // Module-level cache populated on first call. Mutations write through to disk.
  // Scope is per-store-instance, not per-process — fresh createSecretStore()
  // re-reads the file (this is what makes the persistence test work).
  let cache: SecretMap | undefined;

  function load(): SecretMap {
    if (cache !== undefined) return cache;
    if (!existsSync(filePath)) {
      cache = {};
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
    cache = parsed as SecretMap;
    return cache;
  }

  function flush(): void {
    if (!cache) return;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Atomic write: tmp + rename. fs.renameSync uses MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING on Windows so it overwrites atomically.
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
    renameSync(tmp, filePath);
  }

  return {
    setSecret(key, value) {
      const map = load();
      map[key] = protect(value).toString("base64");
      flush();
    },

    getSecret(key) {
      const map = load();
      const b64 = map[key];
      if (b64 === undefined) return null;
      return unprotect(Buffer.from(b64, "base64"));
    },

    deleteSecret(key) {
      const map = load();
      if (key in map) {
        delete map[key];
        flush();
      }
    },

    listSecretKeys() {
      return Object.keys(load());
    },
  };
}
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `./bun.exe test tests/secrets.test.ts`
Expected:
```
 1 pass
 0 fail
```

- [ ] **Step 3: Verify nothing else regressed**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **48 pass / 0 fail** (was 47 before this task).

---

## Task 5: Add the remaining 6 tests

**Files:**
- Modify: `tests/secrets.test.ts`

- [ ] **Step 1: Append the additional tests inside the existing `describe` block**

Add these 6 tests after the existing `set/get round-trip — basic ASCII` test, inside the same `describe("secrets store", () => { ... })`:

```ts
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
```

You'll also need to extend the imports at the top of `tests/secrets.test.ts` to bring in `readFileSync` and `writeFileSync`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

- [ ] **Step 2: Run all the new tests and confirm they pass**

Run: `./bun.exe test tests/secrets.test.ts`
Expected:
```
 7 pass
 0 fail
```

- [ ] **Step 3: Verify the full suite is green**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: clean typecheck, **54 pass / 0 fail** (47 pre-existing + 7 new).

---

## Task 6: Clean up PLAN.md inconsistencies

**Files:**
- Modify: `PLAN.md` (5 line edits + 1 paragraph addition)

The original plan was written before the design was nailed down and conflates DPAPI (encryption) with Windows Credential Manager (storage). The spec explicitly chose DPAPI primitives + our own JSON file. This task aligns the plan text with that decision so future readers don't get confused.

- [ ] **Step 1: Fix line 85**

Replace:
```
- **Windows-only** target for launch (single OS; use DPAPI via Windows Credential Manager, `%APPDATA%` for local data, `.bat` launchers, CRLF tolerant).
```
with:
```
- **Windows-only** target for launch (single OS; use DPAPI (`CryptProtectData`) for at-rest secret encryption stored in our own `secrets.json`, `%APPDATA%` for local data, `.bat` launchers, CRLF tolerant).
```

- [ ] **Step 2: Fix line 113**

Replace:
```
- **Secrets**: Windows Credential Manager via DPAPI (small FFI wrapper). API keys scoped per-environment (e.g. `apply-prod`, `banner-test`). Keys never written to disk or logs in plaintext.
```
with:
```
- **Secrets**: Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`, small `bun:ffi` wrapper around `crypt32.dll`). Ciphertexts stored in `%APPDATA%\api-catalog-explorer\secrets.json` — entirely in-app, nothing visible in `Manage Windows Credentials`. API keys scoped per-environment (e.g. `apply-prod`, `banner-test`). Keys never written to disk or logs in plaintext.
```

- [ ] **Step 3: Fix line 243**

Replace:
```
- **Environment profiles** (tenant-level, shared across all APIs). Stored in `%APPDATA%\api-catalog-explorer\environments.json`; secrets in Windows Credential Manager via DPAPI, never on disk plaintext.
```
with:
```
- **Environment profiles** (tenant-level, shared across all APIs). Stored in `%APPDATA%\api-catalog-explorer\environments.json`; secrets DPAPI-encrypted in a sibling `secrets.json`, never on disk plaintext.
```

- [ ] **Step 4: Fix line 359**

Replace:
```
- `dpapi.test.ts` — round-trip encrypt/decrypt of a fake secret via Credential Manager; asserts never-persisted-plaintext.
```
with:
```
- `secrets.test.ts` — round-trip encrypt/decrypt of a fake secret via Windows DPAPI; ciphertexts stored in our own JSON file, never visible outside the app; asserts never-persisted-plaintext on disk.
```

- [ ] **Step 5: Fix line 391**

Replace:
```
- `src/auth/dpapi.ts` — Windows Credential Manager FFI wrapper.
```
with:
```
- `server/auth/dpapi.ts` — Windows DPAPI FFI wrapper (`CryptProtectData` / `CryptUnprotectData` against `crypt32.dll`).
- `server/auth/secrets.ts` — generic key/value secret store on top of DPAPI; persists base64 ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` via atomic tmp+rename writes.
```
(Note this swaps `src/` to `server/` for path accuracy and adds the new `secrets.ts` line.)

- [ ] **Step 6: Add an architecture note to the Phase 2 section**

In the Phase 2 "Must-have" list, replace item 2 (line 505):
```
2. **Windows DPAPI wrapper** (`server/auth/dpapi.ts`) — Bun FFI against `crypt32.dll` for `CryptProtectData` / `CryptUnprotectData`. Secrets never on disk in plaintext, never in exports. Unit tests around round-trip.
```
with:
```
2. **Windows DPAPI secret storage** — two-layer split. `server/auth/dpapi.ts` is a thin `bun:ffi` wrapper around `CryptProtectData` / `CryptUnprotectData` from `crypt32.dll` (no I/O). `server/auth/secrets.ts` is a generic key/value store on top, persisting base64 ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` via atomic tmp+rename writes. Entirely in-app — no `CredWrite`, nothing visible in `Manage Windows Credentials`. End-to-end tests in `tests/secrets.test.ts` cover round-trip (ASCII + unicode), delete, list, plaintext-not-on-disk, persistence, and tampered-ciphertext rejection.
```

- [ ] **Step 7: Verify**

Run: `./bun.exe run typecheck && ./bun.exe test`
Expected: still **54 pass / 0 fail**, clean typecheck. (Pure docs change — these should not have moved.)

Spot-check the edits visually with: `grep -n "Credential Manager" PLAN.md`
Expected: no results.

---

## Done condition

After Task 6:
- `server/auth/dpapi.ts` exists and round-trips DPAPI via FFI
- `server/auth/secrets.ts` exists and exposes `createSecretStore(path)`
- `server/config.ts` exposes `SECRETS_PATH`
- `tests/secrets.test.ts` passes 7 tests
- Full suite: **54 pass / 0 fail**, typecheck clean
- `PLAN.md` no longer mentions "Credential Manager" anywhere
- The DPAPI module pair is ready to be consumed by the next Phase 2 task (environment profile manager)
