# Environment Profile Manager — Design

> **Partially obsolete — DPAPI references no longer apply.** The DPAPI integration described here was removed in the 2026-05-01 pivot; secret storage is now plaintext in `./data/secrets.json`. The rest of the env-profile design (CRUD, active-env, top-bar selector, region) is current.

**Date:** 2026-04-23
**Status:** Shipped (Phase 2). DPAPI integration removed in 2026-05-01 pivot.
**Phase:** 2 — Real API calls

## Goal

Let the user create, edit, delete, and switch between Ellucian tenant environments from within the app. Each environment holds the connection details (URLs, headers, production flag) and a DPAPI-encrypted API key. One environment at a time is "active" — future slices (token exchange, proxy, Try panel) will read from the active profile.

This slice is **deliberately narrow**: it ends at "envs configured, one selected as active." It does **not** include:
- Token exchange against `/auth` (Phase 2 item 3).
- Request proxy, `Accept` header auto-injection, `Authorization: Bearer <jwt>` wiring (Phase 2 item 4).
- The "Test connection" button (belongs with item 3 — requires the token exchange).
- Verb-safety confirm modals (belongs with the Try panel slice).

## Auth model (the important correction)

PLAN.md's Phase 2 item 3 currently describes "OAuth2 Client Credentials (Ethos) — server exchanges `client_id` + `client_secret` for bearer token." That's not what Ethos Integration actually does. The real flow, verified against what the user has observed working:

1. The tenant issues **one API key** (not a `client_id`/`client_secret` pair).
2. Client sends `Authorization: Bearer <api_key>` to the tenant's `/auth` endpoint.
3. Response body is a **plaintext JWT** (not a JSON envelope).
4. Client uses `Authorization: Bearer <jwt>` for subsequent API calls until it expires.

That changes what we store per environment (one secret, not two), the field naming (`apiKey`, not `clientId`/`clientSecret`), and the eventual token-exchange code shape. PLAN.md L247–249 need fixing; see "PLAN.md cleanup" at the end of this spec.

A second decision confirmed during brainstorming: users **must** have an API key — we are not supporting "paste a token directly" or custom-header auth modes in this MVP. One auth mode, period.

## Approach

Three layers, consistent with the shape the DPAPI slice established:

- **`server/environments/store.ts`** — feature-folder module (parallel to `server/auth/`). Factory `createEnvironmentStore(envFilePath, secretStore)` owning the `environments.json` ↔ `secrets.json` coupling. All validation, all atomic writes, all secret cascading live here.
- **`server/routes/environments.ts`** — thin HTTP layer over the store. Five endpoints, registered in the existing dispatcher (`server/routes/index.ts`).
- **`web/settings/`** — new frontend folder containing `SettingsView.svelte` (section-aware shell, single section for now) and `EnvironmentsPanel.svelte` (the CRUD UI). Plus small edits to `App.svelte`, `TopBar.svelte`, `StatusBar.svelte`, `CommandPalette.svelte`.

Everything persists to `%APPDATA%\api-catalog-explorer\`. The DPAPI store built in the prior slice is reused verbatim — no FFI or encryption concerns leak into this module.

## Data model

### The `Environment` record

```ts
interface Environment {
  id: string;                               // stable UUID, server-generated on create
  name: string;                             // user-set display name; mutable; unique across envs
  baseUrl: string;                          // e.g. "https://integrate.elluciancloud.com"
  authUrl?: string;                         // optional override; defaults to `${baseUrl}/auth`
  production: boolean;                      // drives confirm-on-non-GET in future Try slice
  defaultHeaders: Record<string, string>;   // free-form; user puts `Accept: application/vnd.hedtech.integration.v13+json` here if they want
}
```

Deliberately omitted:
- `createdAt` / `updatedAt` — clutter; not consumed anywhere.
- `description` — YAGNI.
- Separate verb-safety toggles — collapsed into `production`.
- OAuth client-credentials fields — wrong model for Ethos (see "Auth model" above).

### `environments.json` on-disk shape

```json
{
  "envs": [
    { "id": "c2f1-…", "name": "apply-prod", "baseUrl": "...", "production": true, "defaultHeaders": { "Accept": "application/vnd.hedtech.integration.v13+json" } },
    { "id": "7af8-…", "name": "banner-test", "baseUrl": "...", "production": false, "defaultHeaders": {} }
  ],
  "activeId": "c2f1-…"
}
```

- `activeId` is `null` (or missing) when no env is active — the default on fresh install.
- Storing `activeId` inside `environments.json` (rather than a separate `active_env.json` or in `config.json`) keeps all env state in one file: one less file to manage and one less load call.
- Hand-editing is supported; if the schema is wrong the store throws on load (same behavior as `secrets.ts`).

### Secret pairing

- The API key lives in the DPAPI `secrets.json` store under the key `env/<id>/api_key`.
- Never appears in `environments.json`.
- Never appears in `GET /api/environments` responses — a `hasApiKey: boolean` flag per env exposes presence without exposing the value.
- Delete of an env cascades: both the `environments.json` entry **and** the `env/<id>/api_key` secret are removed in the same operation.

### Validation (server-side, on create/update)

- `name`: non-empty after `.trim()`, unique across the envs list. Rename to an in-use name is rejected.
- `baseUrl`: `new URL(...)` parses and scheme is `http` or `https`.
- `authUrl`: if present, same URL check.
- `apiKey`: required non-empty on create; on update, omission means "leave unchanged".
- `id`: server-generated via `crypto.randomUUID()` on create; immutable thereafter. Client-supplied `id` on create is ignored.

### Delete / rename semantics

- **Delete env:** remove the record from `environments.json` (and clear `activeId` in the same write if it pointed at the deleted env), then delete `env/<id>/api_key` from the secret store. Each file's write is atomic via tmp+rename, but the two files are not jointly atomic: a crash between the two writes leaves an orphan secret key, which is harmless (nothing reads it — the env record is already gone) and can be swept on a future startup if we ever add GC logic.
- **Rename env:** `name` change is a plain update. `id` is stable, so there's no secret reshuffling — `env/<id>/api_key` continues to work.

## Backend HTTP surface

Five endpoints, registered in `server/routes/index.ts` alongside the existing modules:

| Method + path | Body | Returns |
|---|---|---|
| `GET /api/environments` | — | `{ envs: Environment[], activeId: string \| null }`. Each env includes `hasApiKey: boolean`; `apiKey` itself is never in the response. |
| `POST /api/environments` | `{ name, baseUrl, authUrl?, production, defaultHeaders, apiKey }` | `201` + the created env record (no `apiKey`). |
| `PATCH /api/environments/:id` | Any subset of `{ name, baseUrl, authUrl, production, defaultHeaders, apiKey }` | Updated env record. Omitting `apiKey` leaves it unchanged; a non-empty `apiKey` replaces it. |
| `DELETE /api/environments/:id` | — | `204 No Content`. The store has already cleared `activeId` if the deleted env was active; the UI re-fetches list to observe that. |
| `POST /api/environments/:id/activate` | — | `{ activeId: id }`. |

Design notes:
- No separate `GET /api/environments/active` — `activeId` ships with the list, so one initial fetch populates both the list view and the top-bar selector.
- No "clear active" endpoint — active auto-clears on delete; that's the only realistic clear-path.
- Validation failures return `400 { error: "<message>" }`. Missing env → `404 { error: "..." }`. Malformed JSON body → `400`. (Matches the pattern used by the existing route modules; if they've diverged, the implementation plan will reconcile.)

## Frontend

### Routing

Add one variant to the `Route` union in `App.svelte`:

```ts
| { kind: "settings"; section: "environments" }
```

Path: `/settings/environments`. Bare `/settings` is `replaceState`-rewritten to `/settings/environments` (the default section) so typing `/settings` in the URL bar lands somewhere real. The union widens (`| "appearance" | "catalog"`) when those Phase-3/future sections land.

### Files added

- `web/settings/SettingsView.svelte` — the `/settings/<section>` route container. Section-aware shell. For this MVP there's only one section, so it renders `<EnvironmentsPanel>` with a title. When Appearance / Catalog land, the shell grows a left-rail section nav without URL changes.
- `web/settings/EnvironmentsPanel.svelte` — list + add/edit form for environments.

### Files edited

- `App.svelte` — new route variant, `envs` + `activeEnvId` state, `GET /api/environments` on mount, pass-down to TopBar / StatusBar / SettingsView.
- `shell/TopBar.svelte` — real env selector (see below) + gear icon (`⚙`) navigating to `/settings/environments`.
- `shell/StatusBar.svelte` — trivial: already renders `env: {env}`; will receive the resolved active env name (or `"(none)"`).
- `shell/CommandPalette.svelte` — one new command: `Settings: Environments` → navigates to `/settings/environments`.

### State (in `App.svelte`, matches existing pattern)

```ts
let envs = $state<Environment[] | null>(null);
let activeEnvId = $state<string | null>(null);
```

Fetched once on mount via `GET /api/environments`. Mutations hit the API, then patch local state on the response. No separate store module — consistent with how `config`, `summary`, `theme` are held today.

### `EnvironmentsPanel` UX — single column, inline expand

- Header: `Environments (N)` + `[ + Add ]` button.
- Each env rendered as a row containing:
  - Left: name (bold). Badges: red `PROD` pill when `production=true`, green `active` pill when `id === activeId`. Small `•` indicator when `hasApiKey=false` to hint "API key not set".
  - Right: `Activate` button (hidden when already active), `Edit`, `Delete` (confirm modal).
- Clicking `Edit` on a row expands an inline form within that row. Clicking `+ Add` inserts a new blank row at the top of the list, already in edit mode. At most one row is expanded at a time — clicking `Edit` on a different row (or `+ Add` while another row is expanded) collapses whatever was open, discarding unsaved edits after a confirm.
- Form fields: Name, Base URL, Auth URL (optional), Production (checkbox), API key (password input; placeholder `•••••••• (leave blank to keep)` in edit-mode when `hasApiKey=true`), Default headers (simple key/value rows with add/remove).
- `Save` and `Cancel` buttons. `Cancel` on a newly-added (unsaved) row removes the row; on an existing row it collapses back to the read-only view.
- Empty state: `No environments yet.` caption with a prominent `+ Add environment` button below it.

### `TopBar` env-selector wiring

Existing stub is a disabled native `<select>`. Post-wiring:

- Props change: `env: string` → `envs: Environment[]`, `activeId: string | null`, `onActivate: (id: string) => void`.
- Remove `disabled`; render each env as `<option>` with text `name` (or `name (PROD)` for production envs, as a textual cue that survives native-select styling limits).
- Adjacent visual indicator: a `•` dot immediately to the left of the `<select>` that CSS-colors to `--accent-prod` (red on every theme) when the active env is production, and renders hollow / `--text-muted` otherwise. This is the "red dot on production envs" that PLAN.md L245 calls for, on the currently-selected env.
- Extra element in the right-controls cluster: a gear icon (`⚙`) that navigates to `/settings/environments`.

A custom dropdown (where each `<option>` can show its own prod indicator inline) is deferred as later polish — native `<select>` + side dot is good enough for MVP.

### `StatusBar`

Zero structural change. `env` prop is already there. `App.svelte` resolves `activeEnvId → name` (or `"(none)"`) and passes down.

### Command palette

One entry: `Settings: Environments` → navigates to `/settings/environments`. Shape matches whatever `CommandPalette.svelte` currently uses for its other entries.

### Theme support — as a hard constraint

The app ships four themes (phosphor, amber, dos, beige). Every new component in this slice uses **existing CSS variables only**; no hard-coded colors or new hex values. Specifically:

- Badge colors (`PROD`, `active`) resolve through new CSS variables `--accent-prod` and `--accent-active`, added to each theme's token set.
- The top-bar red dot uses the same `--accent-prod`.
- Form inputs, row borders, and hover states reuse the same variables the rest of the app already defines.

The implementation plan will include a verification step that requires eyeballing the Settings page, the empty state, the edit form, and the TopBar red dot in **all four themes** before the UI task is marked done.

## Data flow

- On app mount, `App.svelte` fetches `GET /api/environments` and populates `envs` + `activeEnvId`.
- **Add:** `EnvironmentsPanel` → `POST /api/environments` → on success, append new env to `envs` (state update).
- **Edit:** `EnvironmentsPanel` → `PATCH /api/environments/:id` → on success, replace env in `envs` by id.
- **Delete:** `EnvironmentsPanel` → `DELETE /api/environments/:id` → on success, remove env from `envs`; if the deleted env was active, set `activeEnvId = null` client-side (server has already done the same).
- **Activate** (from TopBar selector or the Activate button): → `POST /api/environments/:id/activate` → on success, update `activeEnvId`.

All network mutations use the same `fetch` + JSON pattern the existing app uses (see e.g. how `config` is loaded in `App.svelte`).

## Error handling

- **Network / HTTP errors:** surfaced in the form as a red error message below Save (`Couldn't save environment: <server message>`). Existing envs in the list are unaffected.
- **Validation errors from the server (`400`):** same surface — display `error` field below the relevant form control.
- **Malformed `environments.json` on startup:** store throws with the file path included. The route returns `500` with the message, and `App.svelte` renders a specific "Environment config is corrupted — open `%APPDATA%\api-catalog-explorer\environments.json` to inspect" message in place of the env selector / panel. We do not silently overwrite the file; the user might be preserving a hand-edited copy.
- **Malformed / tampered secret in `secrets.json`:** DPAPI `unprotect` throws. Active-env selection still works (the env record is valid), but when the future token-exchange slice tries to use the key, it will surface the failure. This slice doesn't call `unprotect` — it only calls `setSecret` / `deleteSecret` — so the user experience in the Settings page is unaffected.
- **Delete of an env that's currently active:** store cascades `activeId` to `null` inside the same atomic write. The UI observes that via the normal delete response; no special client-side logic.
- **Race: user deletes env A while TopBar has A selected as active:** on successful `DELETE`, client sets `activeEnvId = null` locally. TopBar falls back to `(none)` in its selector. Re-fetch on next mount confirms.

## Testing

### Server-side — `tests/environments.test.ts`

Integration tests against a live store (temp `environments.json` + a temp DPAPI-backed `secrets.json`, both cleaned up per test). Runs against the real DPAPI on Windows — same posture as the existing `secrets.test.ts`. Covers:

1. **List empty** — fresh install returns `{ envs: [], activeId: null }`.
2. **Create + list** — POST adds an env; GET returns it with `hasApiKey: true` and the API key absent from the response body.
3. **Rename** — PATCH updates the name; id unchanged; secret still retrievable under the same `env/<id>/api_key`.
4. **Update apiKey** — PATCH with a new apiKey replaces the stored secret; PATCH without apiKey leaves it unchanged.
5. **Duplicate name rejected** — POST (or PATCH to a colliding name) returns 400.
6. **Invalid URL rejected** — POST with `baseUrl: "not-a-url"` returns 400.
7. **Activate** — POST `/activate` sets `activeId`; GET reflects it.
8. **Delete cascades secret** — DELETE removes env and the paired secret in `secrets.json`.
9. **Delete clears active** — DELETE the active env → GET returns `activeId: null`.
10. **Delete non-existent env** — returns 404; no state change.
11. **Malformed `environments.json` on startup** — throws with the file path in the message.

### Frontend — manual browser verification

No component-test infra exists in the repo, and adding one isn't in scope. Per CLAUDE.md, the UI task in the implementation plan requires a browser pass:

- Golden path: add env → activate → edit → rename → delete.
- Validation: try a duplicate name, an invalid URL — confirm the error surfaces below the input, not as a page-level crash.
- Empty state: delete the last env and confirm the empty-state CTA appears.
- Active env indicators: TopBar selector shows the right name; red `•` dot appears when the active env is production.
- StatusBar shows the right env name in its right-hand cluster; says `env: (none)` when no env is active.
- **All four themes:** repeat the golden path quickly in each of phosphor / amber / dos / beige; no clipped text, no contrast failures, no hard-coded-color bleed-through.

## PLAN.md cleanup (part of the implementation plan)

Five edits fold into the env-profile implementation plan's final task:

1. **L244** — replace `"safety settings (confirm, dry-run, body redaction)"` with a shorter line driving all verb safety off the `production` flag alone. Matches what L251 already says.
2. **L247** — rewrite "OAuth2 Client Credentials (Ethos) — server exchanges `client_id` + `client_secret`…" to describe the actual Ethos Integration auth: single API key, sent as `Bearer <api_key>` to `/auth`, receives a plaintext JWT.
3. **L248–L249** — delete the "Secondary: Direct bearer token" and "Tertiary: Custom-header auth" lines. API key is required; the other modes aren't in MVP.
4. **L403** — `src/routes/settings/+page.svelte` references a file path that doesn't match the actual frontend layout (the code is under `web/`, no SvelteKit routing). Replace with `web/settings/SettingsView.svelte` (+ `EnvironmentsPanel.svelte`) wording.
5. **L505** — expand Phase 2 item 1 ("Environment profile manager") to mention the top-bar selector, persisted active env, and the gear-icon Settings entry point, matching what this slice actually delivers.

Line numbers are approximate (will shift as PLAN.md is edited); each edit anchors on its string content in the implementation plan.

## Extensibility — adding a second auth mode later

This MVP supports exactly one auth mode (Ellucian API key + `/auth` exchange). If a tenant ever turns up needing a different mode — direct bearer paste, basic auth, a custom header, or real OAuth2 client-credentials — the migration is small and documented here so future-us doesn't have to reinvent it.

1. **Type widening.** Add `authType: "ellucian-api-key" | "<new-mode>"` to the `Environment` interface. Existing records don't have this field yet, so in `store.ts` `load()` default missing `authType` to `"ellucian-api-key"` — one line, applied on next launch.
2. **New secret slot.** Each new mode gets its own DPAPI key suffix (e.g. `env/<id>/bearer_token`, `env/<id>/basic_password`). The existing `env/<id>/api_key` entries keep working unchanged.
3. **Validation branches by `authType`.** `store.ts` validation picks required fields per mode: API-key mode requires `apiKey` on create; direct-bearer would require `bearerToken`; etc.
4. **UI branches by `authType`.** `EnvironmentsPanel` form shows an auth-type picker; downstream fields conditionally render. The existing "API key" field becomes the default branch of the conditional.
5. **Token-exchange slice (Phase 2 item 3) branches too.** The eventual `server/proxy/ethos.ts` (or wherever the token-exchange code lives) picks the right flow per `authType`. API-key mode hits `/auth`; direct-bearer skips the exchange and uses the token verbatim; etc.

Nothing in this MVP locks us into the single-mode assumption beyond the literal absence of a picker. The `env/<id>/api_key` secret-key shape, the `apiKey` field on the form, the `hasApiKey` flag in the list response — all are already scoped to "the API-key mode's credential", not "every env's one-true-credential". Adding a second mode is additive work, not rework.

## Out of scope

- Token exchange against `/auth`, JWT caching, refresh-on-401 — Phase 2 item 3, its own slice.
- Request proxy (`server/proxy/ethos.ts`), auto-attached `Accept` header, Bearer wiring — Phase 2 item 4, its own slice.
- "Test connection" button — requires the token exchange; lives with item 3.
- Verb-safety confirm modal — lives with the Try panel slice.
- "Paste a JWT directly" auth mode — explicitly out; users must have an API key.
- Custom-header auth — same; out.
- Env import/export, env duplication/cloning, env grouping / tagging — YAGNI for now.
- Component-level tests for Svelte components — no test infra for that in the repo; deferred.
- A custom TopBar dropdown (with per-option prod indicators) — native `<select>` + side dot is sufficient for MVP.

These are deferrable; happy to revisit if they ever become real needs.
