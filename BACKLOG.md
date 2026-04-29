# Backlog

Discovered issues + quality-of-life items that aren't in scope for the active phase's plan. Each entry has a stable ID (`B-###` bug, `QOL-###` polish, `UX-###` design).

**Triage workflow:** discover → log here → triage by phase planning → move into a plan / spec when worked on → tick off below with the commit SHA.

Open items, newest at top.

---

## B-009 — `clearIndexAction` race between detachDb + unlink

**Severity:** low · narrow window · single-user app
**Reported:** 2026-04-29 (post-audit)

`server/routes/indexer.ts` (`/api/index/clear`) calls `detachDb()` and then `await clearIndexFiles(handle)`. Between those two awaits, an incoming request that calls `db()` opens a fresh handle while the file is being unlinked. A4's mutex prevents concurrent *scans*, but doesn't cover other DB readers.

**Fix direction:** wrap the clear in a "drain" — add a `dbBusy` flag that `db()` checks and waits on, OR move the clear behind the same mutex used by indexCatalog (after promoting it from "scan only" to "DB-mutating operations").

---

## B-010 — Schema wipe list is hand-maintained

**Severity:** low · only triggers on a future SCHEMA_VERSION bump
**Reported:** 2026-04-29 (post-audit)

`server/indexer/sqlite.ts:62-72` hardcodes the eight content tables to drop on a forward migration. If a future SCHEMA_V2 adds a new table that also exists in V1 (or renames one), an upgrade-from-half-migrated DB silently keeps stale rows. The schema-migration test pins the same hand-list, so a forgotten table won't trip CI either.

**Fix direction:** before SCHEMA_V2 lands, switch the wipe to "drop everything in `sqlite_master` not in a known-keep list (just `meta`)".

---

## QOL-004 — `LastScanStatus` type duplicated across 3 modules

**Severity:** low · drift risk
**Reported:** 2026-04-29 (post-audit)

`server/routes/indexer.ts:11`, `web/App.svelte:45`, `web/shell/StatusBar.svelte:11`, `web/shell/CatalogOverview.svelte:15` all redefine `LastScanStatus`. Adding a new status (e.g. `"partial"`) means editing four places.

**Fix direction:** extract to `web/lib/scan-status.ts` (mirror of the server-side constant), import from both sides.

---

## UX-003 — Picker dropdown options + breadcrumbs lack `onkeydown`

**Severity:** low · accessibility
**Reported:** 2026-04-29 (post-audit)

`web/docs/try/CriteriaFilter.svelte` `.cf-opt` and `web/docs/response/tabs/TableTab.svelte` breadcrumb links use `role="button" tabindex="0"` but only handle `onclick`. Enter/Space keypresses don't trigger them, so keyboard-only users can't activate either.

**Fix direction:** add `onkeydown` handlers that call the same activation function on Enter / Space.

---

## QOL-005 — `decodeQueryValues` doesn't handle hash fragments

**Severity:** low · Ethos URLs don't use fragments today
**Reported:** 2026-04-29 (post-audit)

`web/lib/url-display.ts` splits on `?` and decodes everything after, including the hash fragment if present. A URL like `/api/x?foo=1#section=2` would route `section=2` through `tryDecode`. Not exploitable, but wrong if the convention ever shows up.

**Fix direction:** strip `#…` from the input before splitting on `?`.

---

## QOL-006 — Tree-view chevron + close padding magic numbers

**Severity:** low · cosmetic
**Reported:** 2026-04-29 (post-audit)

`web/docs/response/JsonTree.svelte:99` (`.chev { width: 14px }`) and `:107` (`.close { padding-left: 14px }`) are independent magic numbers that must stay in sync for the closing brace to align under the opener. A `--tree-indent: 14px` CSS variable on the component would couple them.

---

## B-011 — `inferRootShapes` keeps only the first shape per rootKey

**Severity:** low · rare conflict, no real-world failures observed
**Reported:** 2026-04-29 (post-audit)

`web/lib/criteria-scraper.ts:21` skips subsequent shape entries if the first is already set. If a description's example shows two blocks with conflicting shapes for the same rootKey (e.g. both `{x: "scalar"}` and `{x: [{...}]}` appear), the second is silently ignored. Doesn't affect any production Ellucian descriptions today.

**Fix direction:** if shapes disagree, prefer `array-of-objects` (most permissive on the wire) and surface as a UI hint.

---

## QOL-007 — Indexer finalize phase ignores abort

**Severity:** low · stale-cleanup runs unconditionally after the loop
**Reported:** 2026-04-29 (post-audit)

`server/indexer/index.ts` runs `removedFiles` query, the wipe transaction, and `wal_checkpoint(PASSIVE)` after the per-file loop exits normally. If abort fires *during* finalize (e.g. between the last file and the checkpoint), nothing checks. Minor — the work is bounded.

---

## QOL-008 — `_oldSchema` parameter unused in `reprojectFormState`

**Severity:** low · refactor
**Reported:** 2026-04-29 (post-audit)

`web/docs/try/version-migration.ts:44` accepts `_oldSchema` (underscore-prefixed for "intentionally unused") but the function never reads it. Either drop the parameter or use it for "did the param's shape itself change" detection.

---

## (closed items live below; moved here when shipped)

### Closed in the 2026-04-29 post-audit pass

- **B-012** — Bun.serve `idleTimeout` of 10s killed slow Ethos criteria calls → `bd1a406` _fix(server): raise Bun.serve idleTimeout to 255s_ (criteria queries that scan SPRIDEN-scale tables routinely run >10s; the proxy connection was being severed mid-flight and the client got a Network-error response with no JSON body, which manifested as "criteria broken + Table tab grayed out". Cap raised to Bun's 255s max so neither the proxy nor the SSE indexer scan are throttled)
- **A1** — CriteriaFilter Raw mode wire-shape preservation → `10b209f` _fix(try): preserve raw-mode wire shape_ (Form→Raw round-trip rebuilt JSON in array-of-objects shape regardless of declared shape; CriteriaFilter is now shape-aware via `inferRootShapes`, and `criteriaRaw` per-param literal text override makes raw mode lossless)
- **A2** — Unknown-rootKey wrap default → `10b209f` _(same commit)_ (URL builder defaulted to `[…]` when no description-derived shape was available; now defaults to plain `{…}` for safer preservation of user intent)
- **A3** — Schema downgrade silent corruption → `13e5824` _fix(indexer): refuse to silently downgrade the index DB_ (newer DB read by older binary now throws instead of writing schema_version backwards; openIndex closes the handle on migrate failure to prevent EBUSY)
- **A4** — Concurrent scan guard → `396eaf1` _fix(indexer): reject concurrent scans_ (process-level mutex; routes return 409 / SSE error code "scan-in-flight"; resolves race between triggerRescan and confirmAndIndex)
- **A5** — TryPanel proxy-error JSON detection → `72934a0` _fix: small correctness cleanups_ (B-007 missed `TryPanel.svelte:278` — now uses `isJsonContentType` consistently)
- **A6** — `prevApiKey` $effect mutation cleanup → `72934a0` _(same commit)_ (demoted to plain `let` so the effect doesn't self-retrigger on its trailing assignment)
- **A7** — Ctrl+Shift+H uses `e.code` → `72934a0` _(same commit)_ (layout-independent KeyH binding)
- **A8** — CatalogOverview accept summary as prop → `649031c` _fix: drop CatalogOverview duplicate fetch + walker abort propagation_ (App now owns the summary fetch; overview re-renders cleanly after rescan instead of going stale)
- **A9** — walkCatalog AbortSignal propagation → `649031c` _(same commit)_ (per-readdir-boundary abort checks; abort during the 4377-file enumeration now stops within one directory rather than running the full walk)

### Closed in the 2026-04-29 backlog wave

- **B-008** — single-table response mode broke DataTable scrolling → `e9eb040` _fix(response): single-table mode swallowed scroll viewport_ (academic-year-codes-style flat-array responses showed only the first visible chunk with no scrollbar; rail-less mode flipped TableTab's layout to `display:block` and broke the flex height-chain that DataTable's `overflow:auto` relied on)
- **B-007** — Response panel didn't recognise vendor `+json` content types as JSON → `fa0f82e` _fix(response): treat any +json content type as JSON_ (Ethos returns `application/vnd.hedtech.integration.v6+json`; `startsWith("application/json")` rejected it, so Table tab + Tree/Pretty toggles were disabled. Added `isJsonContentType` helper accepting RFC 6838 +json suffix)
- **B-006** — criteria URL builder always wrapped values in `[…]` regardless of wire shape → `84f7978` _fix(try): wire-shape per criteria rootKey_ (surfaced after B-005 made personFilter editable: scalar-shape params like `?personFilter={"personFilter":"abc"}` were emitted as `{"personFilter":[{"personFilter":"abc"}]}` and rejected 500. Wire shape now derived per-rootKey from the description-scrape via `inferRootShapes`)
- **B-005** — multiple object-type query params silently un-editable → `80cd48e` _fix(try): render every object-type query param via CriteriaFilter_ (discovered + fixed mid-session: persons `personFilter`, academic-catalogs `sort`/`criteria` couldn't accept input because only the first object-type query param was wired to CriteriaFilter; the rest fell through to SchemaInput's empty `type:object` branch)
- **UX-001** — Try panel theme contrast → `d1f8a0e` _fix(theme): tokenize Try-panel + Response-panel hard-coded colours_
- **UX-002** — home button in top bar → `20cc15c` _feat(shell): home button in top bar_
- **QOL-002** — filter matches parent field names → `8c719a1` _fix(try): filter matches parent field names + dotted paths_
- **QOL-001** — kill "Task 15" placeholder → `30e6375` _chore(try): rewrite no-endpoint placeholder copy_
- **B-001** — wizard flash on app start → `019d939` _fix(boot): eliminate wizard flash on cold start_
- **B-002** — TryPanel orphan-on-API-nav → `54123e7` _fix(try): clear focused endpoint when switching to a different API_
- **B-003 + QOL-003** — indexer abort + incomplete-index UI → `c5d7737` _feat(indexer): abort signal + incomplete-index UI_
- **B-004** — schema migration self-heal → `5f06078` _fix(indexer): self-heal schema migrate() on half-migrated DB_
