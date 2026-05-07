# Try Panel — Design

**Date:** 2026-04-23
**Status:** Pending approval
**Phase:** 2 — item 5 (plus item 7 folded in)

## Goal

Let the user focus an endpoint from the docs view, build a valid request (path params, query params, headers, body) via a schema-driven form, and send it through the existing `/api/ethos/*` proxy. This is the first end-to-end UI path that actually hits a real Ellucian tenant — the whole point of Phase 2.

## Scope

**In this slice:**

- `web/docs/TryPanel.svelte` — the main component sitting in the Shell's right slot.
- Endpoint focus interaction in `ApiDocsView` — click an endpoint card to focus it; URL fragment carries the focused endpoint for deep-linking.
- Schema-driven form: URL bar, tabs (Params / Headers / Body), control types per the mapping below.
- **EEDM `criteria={...}` flattening** — description-scraping scraper + progressive-disclosure picker + Raw JSON escape hatch.
- **Verb safety modal** (originally PLAN.md item 7) — confirm dialog on non-GET sends against `production: true` envs. Folded in because it's a small, self-contained interception in the Send path.
- **Inline response stub** — status + body + headers + duration displayed under Send. Not tabs, not a table grid, not a pop-out. That is item 6.
- Lazy-parse of per-endpoint OpenAPI schema on the server (see "Server-side data" below), since the indexer doesn't currently persist it.

**Out of scope (deferred):**

- Full Response panel — tabs (raw / table / headers / timing), SQL-grid table rendering, pop-out window, "Copy as curl" button. That's PLAN.md item 6 with its own brainstorm + slice.
- Request history (SQLite + sidebar + rerun) — PLAN.md item 8.
- Saved snippets / workspaces / collections / chaining.
- Non-JSON request bodies (`multipart/form-data`, `application/x-www-form-urlencoded`).
- Editable URL bar. The URL displays the computed request URL; edits happen in the form.
- OAuth2 or other auth schemes. Ethos Integration Bearer is the only scheme this app supports.

## Endpoint focus and deep-linking

### Focus model

- Endpoint cards in the docs view's Endpoints tab become clickable.
- Clicking a card sets it as the *focused* endpoint — visually highlighted, and the URL fragment gets `#endpoint=<slug>`.
- The Try panel reads the fragment on every navigation and shows the focused endpoint's form.
- If no fragment is set on arrival, Try panel shows a lightweight empty state: "Select an endpoint in the docs pane to try it."
- Switching endpoints via clicking is an instant in-place update — no loading state.

### Fragment slug format

`<METHOD>-<path-slug>` where `path-slug` is the OpenAPI path with:
- Leading `/` dropped.
- `/` replaced with `-`.
- Curly braces stripped (`{guid}` → `guid`).

Examples:
- `GET /persons?limit=10` → `GET-persons`
- `POST /qapi/persons` → `POST-qapi-persons`
- `GET /persons/{guid}` → `GET-persons-guid`
- `DELETE /persons/{guid}/credentials/{credentialId}` → `DELETE-persons-guid-credentials-credentialId`

The Try panel matches the slug against `METHOD path` pairs from the docs data; if there's no match (stale bookmark, removed endpoint), show the empty state.

## UI structure (Try panel internals)

```
┌────────────────────────────────────────────────┐
│ [POST] /qapi/persons                  [Send ▶] │  ← URL bar (read-only, computed)
├────────────────────────────────────────────────┤
│  Params (3)  │  Headers (1)  │  Body           │  ← horizontal tabs
├────────────────────────────────────────────────┤
│                                                │
│  (active tab's content — vertical scroll)      │
│                                                │
├────────────────────────────────────────────────┤
│ Response  · 200 OK · 423 ms                    │  ← inline response stub
│ { … pretty-printed body … }                    │
│ ▸ Headers                                      │
└────────────────────────────────────────────────┘
```

### URL bar

- Read-only display. Shows the computed URL the proxy will call: path + interpolated path params + `?` + encoded query string.
- Updates live as the form changes.
- Send button lives in the URL bar, right-aligned.
- Method badge uses the same semantic-coloured style as endpoint cards (GET / POST / PUT / PATCH / DELETE).

### Tabs

- Horizontal, single-line, compact.
- Each tab shows a small count in parentheses of set values (e.g. `Params (3)` means 3 non-empty param inputs).
- Body tab label becomes `Body` (no count) for methods with bodies; for GET/HEAD/DELETE the tab is present but its content is the empty-state message "(no body for this method)".

### Params tab content

Vertical stack of sections, in this order:

1. **Path parameters** — only rendered when the endpoint path contains `{placeholders}`. One row per path param, typed per schema (GUID-shaped → UUID validator per control mapping).
2. **Query parameters** — one row per spec-declared query param, typed per schema.
   - `criteria` param (wherever it appears) is NOT rendered as a plain text input. It renders as the flattening UX (see its own section below).
3. **Empty state** — when the endpoint has zero path params and zero query params: `(this endpoint takes no parameters)`.

### Headers tab content

- Header rows with editable name + value + `×` remove button.
- `+ Add header` button at the bottom.
- **Locked-but-visible** rows for server-managed headers the user shouldn't hand-edit but should know about:
  - `Authorization: Bearer …` — shown greyed out with text `(injected by server)`. Not editable; the proxy always injects its own Bearer (per proxy spec).
  - `Accept: application/vnd.hedtech.integration.v<N>+json` — auto-computed from the docs-header version dropdown. Shown with a small `auto` label (text, not an icon — no emojis in the UI). Clicking the row toggles it to an editable override; toggling back restores the auto value.
- Env no longer carries `defaultHeaders` (removed in Phase 2 item 4) — all user-facing headers live here.
- Content-Type for the body is auto-set to `application/json` on Send when Body is non-empty, unless the user has explicitly set a Content-Type header.

### Body tab content

- Hidden / empty-state for GET/HEAD/DELETE: `(no body for this method)`.
- For POST/PUT/PATCH:
  - Top toggle `Form | Raw JSON` — default = **Raw JSON**.
  - **Raw JSON mode**: monospaced textarea with syntax highlighting (basic: strings, keys, numbers, booleans, null). `Prefill from schema` button beside the toggle — generates a skeleton object from the OpenAPI schema (required fields present with nulls/defaults; optional fields omitted).
  - **Form mode**: recursive schema-driven renderer. Each nested object is a collapsible fieldset with its own `Form | Raw JSON` sub-toggle (so a sub-tree can fall back to raw editing without flipping the whole body). Required fields get an amber-outline empty-state indicator. Arrays get `+ add item` / `× remove` controls. Switching Form → Raw serialises the current form; Raw → Form re-parses and rejects (with a banner) if the JSON is invalid or doesn't match the schema shape.

## Control type mapping

This table is the contract between schema and rendered control. Matches what we locked in brainstorming.

| OpenAPI schema | Rendered as |
|---|---|
| `string` (plain) | `<input type="text">`, phosphor-styled. |
| `string, enum: [...]` | Custom retro dropdown — same chrome as the `+ Add filter` picker. |
| `string, format: date` | `<input type="date">` with `color-scheme: dark`. |
| `string, format: date-time` | `<input type="datetime-local">` with `color-scheme: dark`. |
| `string, format: uuid` | Text input; validates on blur; red border if not a UUID. |
| `integer` / `number` | `<input type="number">` with `min`/`max` if the schema declares them. |
| `boolean` | Checkbox with explicit `true`/`false` label. |
| `array` of scalars | Chips editor — type-and-Enter to add, `×` to remove each chip. |
| `object` (criteria-shaped) | The flattening UX (see below). |
| `object` (other) | Renders as a nested fieldset in Form mode; raw JSON otherwise. |
| `oneOf` / `allOf` / `anyOf` | Raw JSON editor for that field (too variable to reliably form-render). |

Date/datetime pickers use the **native browser control** — `color-scheme: dark` gives a dark calendar popup that fits well enough. Custom-building a date picker was explicitly out of scope per brainstorm.

## EEDM `criteria={...}` flattening

### The problem

Many EEDM list endpoints (`persons`, `educational-institutions`, `academic-catalogs`, …) declare `criteria` as `type: object` with no `properties`, then document the real filter shapes in the description field as URL examples:

```
/persons?criteria={"names":[{"firstName":"James"}]}
/persons?criteria={"names":[{"lastName":"Abbot"}]}
/persons?criteria={"roles":[{"role":"instructor"}]}
/persons?criteria={"credentials":[{"type":"bannerId","value":"A00000718"}]}
```

The schema tells us nothing; the real documentation is prose. We parse the prose.

### Scraper algorithm

Pure function, client-side, in `web/lib/criteria-scraper.ts`:

1. **Input:** the `criteria` parameter's `description` string from the OpenAPI spec, plus the parameter's `example` (if any).
2. **Regex-find** every `?<paramName>={...}` URL-shaped block in the description, where `<paramName>` is the actual parameter name (`criteria`, `personFilter`, etc. — the scraper is parametrized on the name). Match `\?<name>=(\{[\s\S]*?\})` non-greedy across newlines; be tolerant of balanced-brace errors (skip a block that doesn't parse instead of throwing).
3. **JSON.parse each** extracted block. Skip ones that throw.
4. **Walk each parsed object** to leaf paths. A leaf path is `<rootKey>[].<leafName>` when the root's value is an array of objects (`names` → `[{firstName, lastName}]`). If the root's value is a scalar (`personFilter` → `"guid-string"`), the leaf is just `<rootKey>`.
5. **Also include** the `example` field's extracted leaves (Ellucian sometimes has a richer example than description).
6. **Deduplicate** by leaf path.
7. **Derive labels** via camelCase → Title Case: `firstName` → `First Name`, `lastNamePrefix` → `Last Name Prefix`, `credentialType` → `Credential Type`. The path's `<rootKey>` (`names`, `roles`, `credentials`, …) stays camelCase for display in the picker's group header.

### Output shape

```ts
interface ExtractedFilter {
  rootKey: string;      // e.g. "names", "roles", "credentials"
  leafPath: string;     // e.g. "firstName", "type" (within a credentials[].X)
  label: string;        // e.g. "First Name", "Credential Type"
  fullPath: string[];   // e.g. ["names", "0", "firstName"] for set/get into the JSON
}
type ExtractedFilters = ExtractedFilter[];
```

### UX

- **Initial state (nothing set):** shows `(no criteria set)` with a single row `+ Add filter ▾`.
- **After picks:** each picked filter is a row — `<label>   [input]   ×`. The input is a plain text input (we don't have type info from the description, only from the schema, which is `type: object` and useless). Scalars, dates, UUIDs — all plain text. The user can toggle to Raw JSON if they need special types.
- **Picker dropdown (click `+ Add filter ▾`):**
  - A search box at the top filters the list as the user types.
  - Options are grouped by `rootKey` — the group header (small caps) gives a visual hint of the JSON structure without requiring expand-to-see-leaves.
  - Already-picked filters appear struck-through with `· already added`.
  - Clicking a filter adds it as a chip and closes the dropdown.
- **Form | Raw JSON toggle at the top of the criteria section.** In Raw mode: a JSON textarea showing the computed JSON (starts as `{}`). Edits in Raw mode persist; switching back to Form tries to re-parse into known leaves and flags unknowns with a small warning banner ("couldn't map 2 fields back to form").
- **JSON composition:** when building the outgoing JSON from picked filters, same-root filters combine into one object: `names` picks with `firstName: "James"` and `lastName: "Abbot"` yield `{names: [{firstName: "James", lastName: "Abbot"}]}`. Different roots stay separate: adding `role: "instructor"` yields `{names: [{...}], roles: [{role: "instructor"}]}`.
- **Scraper finds nothing?** The criteria section falls back to the Raw JSON editor as its only mode (the Form toggle is disabled with a tooltip "No filter shapes documented for this parameter"). User can still edit raw JSON.

### Which params get flattened?

Any query parameter whose schema is `type: object` with no `properties` AND whose description contains at least one `?<paramName>={...}` block. In practice this covers EEDM `criteria` and `personFilter` across all the list endpoints. Other object-typed query params fall through to the Raw JSON field control.

## Send flow

1. Keyboard `F5` or `Ctrl+Enter` or clicking the Send button.
2. **Validation pass.** Collect required fields that are empty (path params are always required; query params with `required: true`; body fields per schema in Form mode). Required fields have a small `required` label from initial render so users know ahead of time; on Send attempt with missing values, the offenders gain an amber outline and a banner appears at the top of the panel ("Fill in required fields"). Send does NOT proceed until they're filled.
3. **No active env?** Send is already disabled (tooltip); if somehow triggered, the server will reject with 400 `no-active-environment` and the inline response stub surfaces the error.
4. **Verb safety check.** If the active env has `production: true` AND the method is POST/PUT/PATCH/DELETE, show the modal (below). On Cancel, nothing sends. On Send, proceed. `Shift+F5` on the initial trigger skips the modal for this one request.
5. **Compose the outgoing URL.** Interpolate path params, append encoded query string (using OpenAPI `style: form, explode: true` defaults: `fields=a&fields=b` for array params). The proxy endpoint is always `/api/ethos/<computed-path>`.
6. **Compose headers.** User-set headers from the Headers tab; auto-computed `Accept` from the docs version dropdown unless overridden; `Content-Type: application/json` when there's a body unless overridden. `Authorization` is added by the proxy itself — we don't send one.
7. **Compose body.** In Form mode: serialise the form's JSON object. In Raw mode: the textarea's text (with a preflight JSON.parse to catch malformed JSON before sending).
8. **Send via `fetch("/api/ethos/<path>", {...})`.** The proxy does all its work (Bearer injection, 401 retry, error mapping).
9. **In-flight UI.** Send button shows "Sending…" and disables; an in-flight indicator in the URL bar.
10. **Response arrives.** Populate the inline response stub. Clear the in-flight state.

### Keyboard map

- `F5` — Send (Toad muscle memory).
- `Ctrl+Enter` — Send (modern alternative).
- `Shift+F5` — Send, skipping the verb-safety modal on prod envs.
- `Esc` — in the verb-safety modal, cancels.

## Verb safety modal (PLAN.md item 7 folded)

Trigger: `method !== "GET"` AND active env's `production === true`.

Modal contents:

- Title: "Confirm production send"
- Env name + region badge (e.g. `apply-prod · US`, red dot).
- Method + computed URL on one line.
- Redacted body preview — first ~12 lines of the body. Values of fields whose name contains `password`, `secret`, `token`, `key`, `ssn`, `creditCard` (case-insensitive) are replaced with `[REDACTED]`. The same redaction rule will be reused by item 8 (request history).
- Two buttons: `Cancel` (Esc) and `Send` (Enter).

No `Copy as curl` button in this slice — that's item 6. No permanent "don't ask again" toggle — `Shift+F5` is the per-request skip.

## Inline response stub

Rendered below the Send button (or below the active tab's content; the layout sits under the tab content area and shares vertical space with it). Contents:

```
Response · 200 OK · 423 ms

  [pretty-printed JSON body, monospaced, scrollable]

▸ Headers (click to expand)
  [key: value list when expanded]
```

- **Status line:** `<status> <statusText> · <durationMs> ms`. Colour codes: 2xx green, 3xx dim, 4xx amber, 5xx red.
- **Body:** pretty-print JSON (`JSON.stringify(parsed, null, 2)`) if the response's `Content-Type` starts with `application/json`. Otherwise show the raw body text. Long bodies get a "show all" affordance at some reasonable cap (say 500 lines).
- **Headers:** collapsible block, one `header: value` per line, monospace.
- **Error state:** if the response status is 4xx/5xx AND the body is our proxy's structured error (`{error: "..."}`), render a readable banner above the raw body:
  - `400 no-active-environment` → "No environment is active. Pick one in the top bar."
  - `400 no-api-key` → "The active environment has no API key set. Edit it in Settings → Environments."
  - `502 auth-failed` → "Couldn't exchange the API key for a JWT: <detail>"
  - `502 upstream-unreachable` → "Couldn't reach Ethos: <detail>"
  - Real Ethos errors (401/403/404/etc. from the actual tenant) pass through as-is; no special banner.
- **Clear on endpoint switch.** When the focused endpoint changes, the response stub clears (previous response was for a different endpoint).

### Fate when item 6 ships

When the full Response panel lands (PLAN.md item 6: tabs for raw / table / headers / timing, pop-out window, Copy as curl, SQL-grid table rendering), the Try panel's inline stub **shrinks**, not disappears. The in-Try surface becomes a single status pill above the Send button: `Last: 200 OK · 423 ms · view in Response panel ↓`. That keeps the "did my send complete?" affordance local while the rich views live in the dedicated full-width panel. The pretty-printed body + collapsible headers + error banner behaviour moves verbatim into the Response panel (the error-banner logic is identical either way — structured proxy errors render the same). This is called out in item 6's future brainstorm rather than being a Try-panel refactor.

## State persistence

Scope: per-endpoint form drafts preserved while the app is running.

- In-memory `Map<endpointKey, FormState>` module-level in `TryPanel.svelte` (or a sibling `web/lib/try-panel-state.ts` if it grows).
- `endpointKey = \`${method} ${pathTemplate}\`` — version-independent so switching versions of the same resource preserves drafts.
- `FormState` shape: `{ pathParams: Record<name, string>, queryParams: Record<name, string>, criteria: Record<rootKey, Record<leafName, string>>, headers: Array<{name, value}>, body: { mode: "form"|"raw", text: string }, headersOverridden: Record<name, boolean> }`.
- Hard reload clears all drafts. This is acceptable — the user can re-send from request history (item 8) once that ships.
- No `localStorage` persistence for drafts. Bodies may contain personal data (names, credentials, SSNs). Keeping them ephemeral avoids a secrets-at-rest concern for a feature we don't need yet.

### Version switching while drafts exist

When the docs-header version dropdown changes — e.g. user is editing the form for `persons/12.6.0` and picks `12.7.0` — the Try panel re-fetches the new version's per-endpoint schema and re-renders against it. The previously-typed values are preserved keyed by name and re-projected onto the new schema:

- **Field name + compatible type → value carried over.** A `lastName` text input keeps its value if `lastName` exists in the new version with a string-ish schema.
- **Field name exists but type changed** → input re-renders with the new control; a coercion attempt is made (numeric strings to number inputs, ISO strings to date pickers); failed coercions show an amber outline + tooltip "couldn't fit the previous value into the new schema."
- **Field name no longer present in the new version** → value is preserved in a per-endpoint "orphans" bucket and surfaced as a single banner at the top of the relevant tab: `"2 fields from v12.6.0 (lastNamePrefix, middleName) aren't in v12.7.0. View in Raw JSON to recover."` Switching to Raw JSON view shows the orphaned values inline (commented out or in a separate top-level key, TBD during implementation — the bias is preserve-don't-discard).
- **Body in Form mode** → tries to re-render against the new body schema. If the new schema doesn't accommodate, falls back to Raw mode with the previous serialised JSON intact and a banner.
- **Criteria filters** → picker re-scrapes the new version's description. Already-picked chips persist by leafPath; if a chip's leafPath isn't in the new version's extracted filters, it stays as a chip but gains a small "no longer documented" amber tag (the value still goes in the request — Ellucian commonly accepts undocumented filters).
- **Accept header** auto-recomputes for the new version (`v12+json` → `v13+json`). User overrides on the Accept row are preserved across version switches (they stay overridden).
- **Focused endpoint doesn't exist in the new version at all** → the Try panel shows `"GET /persons isn't in v12.7.0. Pick another endpoint, or revert the version."` Form state for the missing endpoint is kept (it'll come back if the user reverts). The URL fragment is left untouched.

This logic lives in `web/docs/try/version-migration.ts` (a pure function over `FormState + oldSchema + newSchema → {nextState, warnings}`) so it's unit-testable without the component harness.

## Server-side data

### Problem

The existing `/api/apis/:family/:resource` returns per-endpoint metadata (`id, path, method, summary, description, operation_id`) but **not** the OpenAPI `parameters`, `requestBody`, or `responses` schemas. The Try panel needs those for control-type rendering + criteria scraping. The PLAN.md section on SQLite schema lists a `schema_json` column on the `endpoints` table, but that column doesn't exist — the indexer never wrote it. The plan-doc drift from reality matters here and gets corrected as part of this slice.

### Solution

Lazy YAML reparse on demand, server-side. Not an indexer change, not a re-index. The spec is self-contained per file (per PLAN.md "Catalog shape: Self-contained: zero external `$ref`s across files"), so parsing a single YAML to extract one endpoint's schema is ~5-30 ms — negligible next to the Ethos network call.

**New route:** `GET /api/apis/:family/:resource/endpoint?method=<M>&path=<encodedPath>&version=<V>`

Returns:

```ts
{
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: OpenAPIParameter[];       // verbatim from spec
  requestBody: OpenAPIRequestBody | null;
  responses: Record<string, OpenAPIResponse>;  // keyed by status code
}
```

Implementation:

1. Look up the API row by `family, resource, version` to get `file_path`.
2. Check an in-process cache `Map<filePath, {mtime, parsed}>` — if `fs.stat(filePath).mtime` equals cached mtime, reuse.
3. Otherwise read + parse with the existing YAML parser (handles the `\<NL>` quirk; already in `server/indexer/parser.ts`).
4. Walk `paths[<path>][<method>]` to extract the endpoint operation object.
5. Return the relevant subset (parameters, requestBody, responses). Ignore everything else.
6. Cache the parsed spec (not just the endpoint) — the next endpoint lookup on the same spec is instant.

Error cases:

- Spec not found / YAML parse fails → 500 with a diagnostic message. The indexer should have caught this; if it happens, it's a bug.
- Method + path combo not found in spec → 404 `endpoint-not-found`.

### Types

A small client-side OpenAPI type file — `web/lib/openapi.ts` — captures the subset we care about:

```ts
export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenAPISchema;
  example?: unknown;
}

export interface OpenAPISchema {
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
  format?: string;               // "date", "date-time", "uuid", "email"
  enum?: unknown[];
  items?: OpenAPISchema;         // for arrays
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number;
  // oneOf / allOf / anyOf → raw JSON fallback
  oneOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema?: OpenAPISchema; example?: unknown }>;
}

export interface OpenAPIResponse {
  description?: string;
  content?: Record<string, { schema?: OpenAPISchema }>;
}
```

Shared on the server via a sibling or imported from there (path alias `@server` is set up in `vite.config.ts`).

## Files

### New

- `web/docs/TryPanel.svelte` — top-level component. Owns URL bar + tabs + inline response stub. Delegates to children for big concerns.
- `web/docs/try/ParamsTab.svelte` — path + query param rendering.
- `web/docs/try/HeadersTab.svelte` — headers editor.
- `web/docs/try/BodyTab.svelte` — body editor with Form/Raw toggle + Prefill button.
- `web/docs/try/CriteriaFilter.svelte` — the flattening UX (picker + chips + Raw JSON toggle).
- `web/docs/try/SchemaInput.svelte` — dispatches to the right control based on schema. Used recursively for nested form rendering.
- `web/docs/try/VerbSafetyModal.svelte` — the prod-send confirm dialog.
- `web/docs/try/ResponseStub.svelte` — the inline response display.
- `web/lib/openapi.ts` — types describing the OpenAPI subset we consume.
- `web/lib/criteria-scraper.ts` — pure function, extracts filter leaves from description text.
- `web/docs/try/version-migration.ts` — pure function, re-projects FormState onto a new version's schema (see "Version switching while drafts exist" above).
- `server/routes/endpoint.ts` — new route, lazy YAML reparse + per-endpoint schema extraction.
- `tests/criteria-scraper.test.ts` — unit tests for the scraper (bun:test — it's a pure TS function, importable from the web/lib path via the `@web` Vite alias; tests import from the raw path).
- `tests/version-migration.test.ts` — unit tests for the FormState re-projection covering: same-name same-type carryover, type-change coercion, missing-field orphan banner, body Form→Raw fallback, criteria chip "no longer documented" tagging, endpoint-not-in-version handling.
- `tests/endpoint-route.test.ts` — integration test for the new route (tiny fixture YAML + assertions on extracted parameters/requestBody).

### Modified

- `web/docs/ApiDocsView.svelte` — endpoint cards become clickable; focused state visual; fires a fragment update on click. Version dropdown change propagates to Try panel via app-level state (the existing version state lifts up or is exposed via context).
- `web/App.svelte` — wires TryPanel into the Shell's right slot; passes the focused-endpoint data + the active env + the active version; reads/writes URL fragment.
- `server/routes/index.ts` — registers `handleEndpoint` in the dispatcher.

### Untouched

- Indexer (no schema changes, no re-index).
- Environment store, secret store, token cache, proxy — all consumed as-is.
- Response panel (doesn't exist yet; item 6 brainstorm).

## Testing

### Unit (bun:test)

**Criteria scraper** — `tests/criteria-scraper.test.ts`:

- Simple case: description with one `?criteria={"names":[{"firstName":"X"}]}` → extracts `{rootKey: "names", leafPath: "firstName"}`.
- Multiple examples with distinct leaves → all extracted and deduped.
- Nested-object leaves: `{credentials:[{type:"X", value:"Y"}]}` → two leaves (`type`, `value`) under `credentials`.
- Malformed brace (`{"names":[{"x":1}`) → skipped, doesn't throw, other valid blocks still parse.
- Empty description → empty list.
- Label derivation: `lastNamePrefix` → `Last Name Prefix`; `guid` → `Guid`; single-word `role` → `Role`.
- Works against an actual `persons-12.7.0` fixture (copy of the real description): should yield the ~10 filters we know about.

**Endpoint route** — `tests/endpoint-route.test.ts`:

- Known fixture YAML (can reuse `tests/fixtures/small-catalog/`): GET + POST endpoints return correct `parameters` / `requestBody` / `responses`.
- Method + path not in spec → 404 `endpoint-not-found`.
- Parse error surface (malformed YAML) → 500.

No Svelte component tests — the project doesn't have a component-test harness set up. Manual browser smoke test covers the UI.

### Manual browser smoke test

Scripted checklist the user runs in the dev servers (Vite on 5173 + Bun on 5757) after merge:

1. Navigate to an indexed API with a GET list endpoint (e.g. `banner-eedm/persons/12.7.0`).
2. Click the `GET /persons` endpoint card — URL fragment becomes `#endpoint=GET-persons`, Try panel populates with the form.
3. Type a value in `criteria` → First Name, hit `F5`. Response stub shows Ethos's reply (real JSON list, or an `auth-failed`/`no-api-key` structured error if the env isn't fully set up — both acceptable for the test).
4. Switch tab to Headers, verify the auto-Accept row with the lock icon reflects the docs version.
5. Click `POST /qapi/persons` in the docs. URL fragment updates, Body tab appears, defaults to Raw JSON. Click "Prefill from schema" — skeleton populates.
6. Change the top-bar env to one marked `production` (a test one, to avoid real side effects). Send a POST — verb safety modal appears. Cancel works. Shift+F5 skips the modal next time.
7. Reload the page — drafts gone (as expected), focused endpoint preserved via URL fragment.

## Error handling and edge cases

- **No catalog indexed yet** — Try panel is unreachable because there's no API detail page to open. No special handling needed.
- **Spec YAML unreadable** — server returns 500; Try panel shows "Could not load endpoint schema. See indexer logs."
- **Schema declares `oneOf`/`allOf`/`anyOf`** — the relevant field(s) render as a Raw JSON editor with the union described in helper text.
- **Schema has a `$ref`** — shouldn't happen (Ellucian specs are self-contained) but if it does, treat as a raw-JSON fallback with a hint "References aren't resolved in this version."
- **User edits Raw mode JSON to invalid JSON** then clicks Send → preflight parse fails → banner "Body is not valid JSON" at the top of the Body tab, no send.
- **User switches Form → Raw → edits freely → Raw → Form** with fields that don't map back → Form re-renders what it can, shows a single warning banner "2 fields were preserved in Raw but didn't map to form inputs — click Raw to see them."

## Performance notes

- Endpoint schema fetch is a one-per-open operation (~10-50ms YAML reparse + cached afterwards) — fine.
- Criteria scraping is pure text-regex on strings under ~5KB — sub-millisecond.
- Form re-renders on input change — stable because Svelte's reactivity is fine-grained. A 200-field body renders once and reacts locally.
- No streaming concerns — proxy buffers request + response already (per proxy spec).

## PLAN.md cleanup

As part of this slice:

- PLAN.md item 5 gets a concrete summary reflecting what actually shipped (link this spec, mention the scraper algorithm, mention items 6 and 8 are still separate).
- PLAN.md item 7 (Verb safety modal) gets marked "folded into item 5" rather than kept as its own bullet.

The "shipped so far" status line at the top of PLAN.md updates to reflect item 5.

## Future items (out of scope, noted for continuity)

- **Item 6 — Full Response panel.** Tabs (raw / table / headers / timing), SQL-grid array renderer, pop-out window, "Copy as curl," save-response.
- **Item 8 — Request history.** SQLite `request_history` writes via the proxy's `onComplete` hook (the no-op we left in Phase 2 item 4). Sidebar tab, rerun, filter, export JSON/curl. The verb safety modal's redaction rule is the same rule item 8 will use.
- **Saved snippets / collections** — `Ctrl+S` to save the current request under a name; a left-sidebar snippets tab. Not urgent.
- **Editable URL bar** — low priority; form-first is the primary mental model.
