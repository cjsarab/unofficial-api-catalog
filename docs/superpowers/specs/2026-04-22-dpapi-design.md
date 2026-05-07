# DPAPI Secret Storage — Design

**Date:** 2026-04-22
**Status:** Approved (pending implementation plan)
**Phase:** 2 — Real API calls

## Goal

Persist Ethos OAuth `client_secret` (and similar per-environment secrets like
direct bearer tokens or custom-header values) across app launches **without
plaintext-on-disk**, on a Windows-only target, with everything kept inside the
app — no system-managed credential store, no entries visible in
`Manage Windows Credentials`.

## Why bother (a local single-user app)

For a local single-user tool, plaintext-in-APPDATA isn't catastrophic — many
dev tools have shipped exactly that. The two specific things that tip the
scale to "yes, encrypt at rest":

1. **OneDrive Known Folder Move.** Many corporate Windows setups sync
   `%APPDATA%` (or can be configured to). A plaintext `secrets.json` in such a
   folder leaves the user's machine without anyone noticing — into the org's
   OneDrive, possibly indexed, possibly retained after offboarding. DPAPI
   ciphertext is bound to the user account on the originating machine, so the
   leak is defanged.
2. **IT review.** Per the launch plan, corporate IT does a source-code review
   per release. "Stores API keys plaintext in JSON" is the kind of line that
   gets flagged and bounces the release back; "Encrypted with Windows DPAPI"
   passes review without comment. Cost-of-getting-it-wrong is high (release
   blocked) vs. cost of doing it right (small).

DPAPI does **not** protect against malware running as the same user (it has
DPAPI access too) or against process-memory inspection at runtime (plaintext
is in RAM regardless). This is specifically a disk-at-rest defence for the two
scenarios above.

## Approach

**DPAPI primitives only**, kept entirely in-app:

- Encrypt with `CryptProtectData` / `CryptUnprotectData` from `crypt32.dll` via
  `bun:ffi`.
- Store the resulting ciphertext blobs as base64 in a JSON map at
  `%APPDATA%\api-catalog-explorer\secrets.json` — a file we own, sibling of
  `environments.json`.
- **Not** `CredWrite`/`CredRead` (Windows Credential Manager) — explicitly
  rejected because the user wants everything in-app, no entries in the OS
  credential GUI.

## Architecture

Two-layer split, both files in `server/auth/`:

### `server/auth/dpapi.ts` — FFI primitives

Pure FFI wrapper. Knows nothing about files, keys, or env profiles.

```ts
export function protect(plaintext: string): Buffer
export function unprotect(ciphertext: Buffer): string
```

Implementation: `bun:ffi` `dlopen("crypt32.dll")` binding `CryptProtectData`
and `CryptUnprotectData`. Marshals `DATA_BLOB` structs (`{cbData, pbData}`).
Throws on failure with the Win32 error code from `GetLastError`.

Approximately 80 lines.

### `server/auth/secrets.ts` — key/value store

Generic key/value secret store on top of the DPAPI primitives. Persists
ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` as base64-encoded
blobs in a `{ "<key>": "<base64>" }` map.

```ts
export function setSecret(key: string, value: string): void
export function getSecret(key: string): string | null
export function deleteSecret(key: string): void
export function listSecretKeys(): string[]
```

Approximately 80 lines including file IO. Uses a module-level cache populated
on first call; mutations write through to disk.

### Why separate the layers

- The FFI layer is small and Windows-specific; the store layer is pure file
  IO + a pluggable encryption call. Separating them keeps each focused and
  testable on its own terms.
- Future env-profile code (a separate Phase 2 task) calls
  `setSecret(\`env:${envId}:client_secret\`, value)` — it never imports
  `dpapi.ts` directly. This keeps the env layer agnostic of the encryption
  mechanism and gives us a clean swap point if the encryption story ever
  changes.

## Storage layout

A single file: `%APPDATA%\api-catalog-explorer\secrets.json`.

```json
{
  "env:apply-prod:client_secret": "<base64 DPAPI ciphertext>",
  "env:banner-test:bearer": "<base64 DPAPI ciphertext>"
}
```

- Sibling of `environments.json` (also in the same APPDATA folder), not
  inlined into it. This keeps human-editable config separate from opaque
  ciphertext bytes, and lets the user nuke secrets (e.g. after rotating a key
  upstream) without touching env structure.
- Key shape (`env:<envId>:<slot>`) is owned by the *caller* (env manager).
  `secrets.ts` treats keys as opaque strings.

## Data flow

- `setSecret(k, v)` → `protect(v)` → base64-encode → mutate cached map →
  write JSON map to `secrets.json.tmp`, then rename to `secrets.json` (atomic
  write — protects against half-written files if power is lost mid-write).
- `getSecret(k)` → load map (cached on first call) → look up base64 → if
  missing, return `null`; else base64-decode → `unprotect()` → return the
  plaintext.
- `deleteSecret(k)` → load map → `delete map[k]` → flush atomically.
- `listSecretKeys()` → load map → `Object.keys(map)`.

Synchronous file IO is fine here — the file is sub-1KB even with 20 secrets,
and writes only happen on user actions like "save env profile", not in any
hot path.

## Error handling

- DPAPI calls return BOOL. On `false`, call `GetLastError` (also via FFI) and
  throw `Error("DPAPI failed: <code>")`. The only realistic failure is
  `unprotect` on a blob that wasn't created by the current user account.
- `getSecret(missing)` returns `null` — that's normal (first-time setup of a
  new env).
- `unprotect` failure re-throws. The caller (env manager UI) decides whether
  to delete-and-reprompt the user. We deliberately do *not* silently swallow
  — a corrupted secret shouldn't auto-fix to "no secret" without the user
  noticing, because that would mask malicious tampering or an OS-account
  change.
- Missing `secrets.json` → return an empty map (normal first run).
- Malformed JSON → throw with a clear message including the file path. Don't
  silently overwrite a partially-corrupted file; it might be a backup we
  shouldn't destroy.

## Testing

Single Bun test file at `tests/secrets.test.ts`, pointed at a temp file via
an injectable path argument (so tests don't touch real `%APPDATA%`):

1. set/get round-trip — basic ASCII value
2. set/get round-trip — non-ASCII / unicode value
3. delete removes the key; subsequent `getSecret` returns `null`
4. `listSecretKeys` returns all current keys
5. plaintext does **not** appear in the on-disk file (read raw bytes, scan
   for the secret string — guards against accidentally writing plaintext via
   a future regression)
6. persistence across fresh module load: write a key, instantiate a fresh
   secret store at the same file, read back the identical value
7. tampered ciphertext throws: write a key, mutate one base64 character in
   the file, expect `getSecret` to throw (not return null)

No standalone `dpapi.test.ts`. The FFI layer is tested implicitly through
`secrets.ts`. If we ever need to mock the FFI layer for env-manager tests,
we'll extract a fake at that point.

The tests run on Windows only — no platform-skip guards needed because the
project is Windows-only by design.

## PLAN.md cleanup

Five lines mention "Credential Manager" in ways that contradict this design
(verified by grep against the current PLAN.md). Fix them all in one pass when
implementing:

- L85, L113, L243, L391: replace "Windows Credential Manager via DPAPI"
  framing with explicit "Windows DPAPI (`CryptProtectData`)" + the
  `secrets.json` file location.
- L359: test description updated from "via Credential Manager" to "via DPAPI;
  ciphertexts stored in our own JSON file, never visible outside the app".
- L505: already correct, leave alone.
- Add a short note in the Phase 2 plan section (around L505) noting the
  two-layer split (`dpapi.ts` + `secrets.ts`) and the in-app-only storage
  stance (no `CredWrite`, nothing visible in `Manage Windows Credentials`).

## Out of scope

- The env-profile manager itself (separate Phase 2 task; will consume this
  module).
- Key rotation, multiple-user-account support, the DPAPI `pOptionalEntropy`
  parameter, audit logging.
- Cross-platform support — Windows-only by design.
- Async file IO — synchronous is correct for this scale.

These are deferrable; happy to revisit if they ever become real needs.
