# Backlog

Discovered issues + quality-of-life items that aren't in scope for the active phase's plan. Each entry has a stable ID (`B-###` bug, `QOL-###` polish, `UX-###` design).

**Triage workflow:** discover → log here → triage by phase planning → move into a plan / spec when worked on → tick off below with the commit SHA.

Open items, newest at top.

---

### Discovered in 2026-05-01 pre-Phase-3 audit

The audit was a no-functional-change sweep before starting Phase 3 UI-settings work. Three Explore agents covered (a) stale Bun references, (b) CSS consistency, and (c) code duplication / dead code. Items tagged **blocking** are prerequisites for the Phase 3 theme switcher / UI scaler; **cosmetic** items are drift that doesn't break anything but should be cleaned for long-term consistency.

---

## QOL-030 — Response-panel size thresholds duplicated as separate constants

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/response/tabs/RawTab.svelte:14,19` defines `HEAD_THRESHOLD_BYTES` and `TOKENIZE_MAX_BYTES`, both = `1024 * 1024`. Two named constants with identical values invite drift if either is later tuned without considering the other.

**Fix direction:** if they must move together, collapse to one `RESPONSE_SIZE_THRESHOLD`. If they're conceptually independent (e.g., we might want to tokenize at a higher cap than head-slice), keep both but move to `web/docs/response/constants.ts` and document the relationship in a comment.

---

## QOL-029 — Picker timeout (5 min) is a literal magic number

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`server/validation/picker.ts:32` has `5 * 60 * 1000`. Single-site magic number; should be a named constant if not centralized.

**Fix direction:** declare `PICKER_TIMEOUT_MS = 5 * 60 * 1000` at top of `picker.ts` (or move to a `server/constants.ts` if more constants accrue).

---

## QOL-028 — HTTP status codes hardcoded across server routes (~30 sites)

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`server/routes/*.ts` has ~30 instances of `{ status: 400 }`, `{ status: 404 }`, `{ status: 409 }`, `{ status: 500 }`. Hardcoded numbers are readable but brittle if the HTTP semantics ever shift.

**Fix direction:** declare `HTTP_BAD_REQUEST = 400`, `HTTP_NOT_FOUND = 404`, `HTTP_CONFLICT = 409`, `HTTP_SERVER_ERROR = 500` in a shared constants file (or fold into the QOL-024 helper).

---

## QOL-027 — `typeof x !== "object" || x === null` guard repeated (~8 sites)

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

The same type-guard appears across `server/routes/endpoint.ts:33,36,42,45` and a handful of other route files. Each one validates a YAML-parsed nested object.

**Fix direction:** extract to `server/lib/is-object.ts` (`export function isObject(x: unknown): x is Record<string, unknown>`). Replace at every callsite.

---

## QOL-026 — FTS5 virtual tables + triggers maintained but never queried

**Severity:** low · dead code · ~15% write throughput cost on re-index
**Reported:** 2026-05-01 (pre-Phase-3 audit, confirms a PLAN.md "Phase 1 — Known issues" item)

`server/indexer/sqlite.ts:248-278` (and the `api_fts` / `columns_fts` virtual tables earlier in `SCHEMA_V1`) define 8 INSERT/DELETE triggers that fire on every `apis` and `columns` write. `server/routes/search.ts` uses hand-rolled `LIKE` queries instead — FTS5 is dead code. PLAN.md notes the triggers cost ~15% write throughput during a full re-index.

**Fix direction:** two paths. (a) Wire `/api/search` to FTS5 (better fuzzy ranking, lower per-query cost) — meaningful UX win. (b) Drop the FTS5 tables + triggers entirely until a future phase wants them — clean removal, claws back the write throughput. Decide based on whether Phase 3+ search work is imminent.

---

## QOL-025 — `SELECT count(*) as c FROM …` boilerplate repeated (~7 sites)

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`server/indexer/index.ts:362-363`, `server/routes/indexer.ts:107-114,127` and a few others all do `db.query<{ c: number }, []>(\`SELECT count(*) as c FROM <table>\`).get()?.c ?? 0`.

**Fix direction:** add `countRows(db: Database, table: string, where?: string): number` to `server/indexer/sqlite.ts` (alongside `getMeta`/`setMeta`). Replaces 7+ lines of boilerplate with a one-liner each.

---

## QOL-024 — Repeated `Response.json({ error }, { status })` shape (~33 sites)

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

~33 callsites across `server/routes/*.ts` follow the pattern `Response.json({ error: "<msg>" }, { status: 400|404|409|500 })`, with occasional extra fields. Encourages drift in error-response shape.

**Fix direction:** create `server/routes/helpers.ts` with `errorResponse(message: string, status: number, extra?: Record<string, unknown>): Response`. Pairs naturally with QOL-028 if both are adopted.

---

## QOL-023 — `formatBytes` duplicated between App.svelte and response/format.ts

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/App.svelte:583-584` and `web/docs/response/format.ts:10-11` both define `formatBytes`. The response-panel one is the more reusable location.

**Fix direction:** consider moving `web/docs/response/format.ts` → `web/lib/format.ts` (it's not response-specific), then import from `App.svelte` and delete the local copy. Sweep for any other duplicates of `formatMs` while in there.

---

## QOL-022 — Four `acx:…:v1` localStorage keys with no shared migration

**Severity:** low · drift / future schema-bump risk
**Reported:** 2026-05-01 (pre-Phase-3 audit, confirms a PLAN.md "Phase 1 — Known issues" item)

`web/App.svelte:87` (`acx:theme:v1`), `web/sidebar/FamilyTree.svelte:25` (`acx:family-expanded:v1`), `web/sidebar/Sidebar.svelte:37` (`acx:sidebar:v1`), `web/shell/Shell.svelte:42` (`acx:layout:v1`). Each component reads/writes its own key; no shared utility, no coordinated v2 migration path.

**Fix direction:** centralize in `web/lib/storage.ts` with typed `getStored<T>(key, fallback)` / `setStored<T>(key, value)` and a single `migrateAll()` function for future schema bumps. Ideal time to fix is *before* Phase 3 introduces more storage keys (e.g., for the UI scaler, CRT toggles).

---

## QOL-021 — Lineage helpers (TOKEN_RE, splitExpression, prettyFieldPath) duplicated across profile views

**Severity:** medium · maintainability — already noted in PLAN.md "Phase 1 — Known issues"
**Reported:** 2026-05-01 (pre-Phase-3 audit, confirms PLAN.md known issue)

`web/docs/ApiDocsView.svelte:106-147` and `web/docs/ColumnProfile.svelte:90-135` both define a `TOKEN_RE` regex (`[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+`), a `splitExpression`/`splitExpr` function, and a `prettyFieldPath`. `web/docs/TableProfile.svelte` likely shares these too. Names drift slightly between files. The CSS classes (`.column`, `.table`, `.text`) styling the rendered output also duplicate.

**Fix direction:** extract to `web/lib/lineage.ts` with a single canonical name set. Pair with a shared CSS class set (or `:global` rules in `web/styles/_lineage.css`) so the visual styling doesn't drift either.

---

## QOL-020 — Heading sizes use mixed units (rem vs px)

**Severity:** low · cosmetic — relevant to UI scaler
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/settings/AppearancePanel.svelte:43` uses `font-size: 1.1rem` (good — scales with root). Other files like `web/App.svelte:881` (`14px`) and `web/docs/ColumnProfile.svelte:360` (`22px`) hardcode pixel sizes. ~10–15 heading rules drift.

**Fix direction:** define `--fs-h1`, `--fs-h2`, `--fs-h3` (and a base `--fs-base` in rem) in `web/styles/theme.css`, sweep heading rules to use them. Subset of the broader QOL-012 work.

---

## QOL-019 — Repeated layout patterns across profile views (.pad, .glance-card, list-reset)

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

Classes like `.pad` (padding tokens), `.glance-card` (border + padding + bg), and `ul.api-list` reset rules appear verbatim in `web/docs/ApiDocsView.svelte:332`, `web/docs/ColumnProfile.svelte:338`, `web/docs/TableProfile.svelte:233` and a couple more.

**Fix direction:** extract to `web/styles/_utilities.css` (or a small set of shared classes). Removes 30-40 lines of repeated CSS.

---

## QOL-018 — JsonTree + RawTab `:global()` token-color rules duplicated

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/response/JsonTree.svelte:120-125` and `web/docs/response/tabs/RawTab.svelte:157-164` both define `:global(.tk-key)`, `:global(.tk-string)`, `:global(.tk-number)`, etc. with identical or near-identical rules. The duplication is intentional-ish (token highlighting must be global so any renderer's output gets coloured) but means a theme tweak has to land in two places.

**Fix direction:** extract to `web/styles/_json-syntax.css` and import once at the app root.

---

## QOL-017 — `var(--fg, #fallback)` fallback hex values are inconsistent

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/TryPanel.svelte:481-482` and `web/docs/try/CriteriaFilter.svelte:304` (and ~20-30 more sites) use `var(--fg, #a9ff68)` / `var(--fg-dim, #6ba544)` / `var(--fg, #ccc)` — fallback values that lock in the phosphor palette if the token resolution fails. Different files use different fallbacks for the same token.

**Fix direction:** drop the fallback hex values. Theme.css should always define every token; if a token is missing the right fix is to add it there, not to drop a phosphor-flavoured default in a component. Sweep with a regex for `var\(--[^,]+,\s*#`.

---

## QOL-016 — Inconsistent micro-spacing (sub-4px hardcoded vs `--space-*`)

**Severity:** low · cosmetic — also blocks UI scaler at the small end
**Reported:** 2026-05-01 (pre-Phase-3 audit)

Many components mix `var(--space-N)` with hardcoded sub-4px values like `2px 0`, `4px 0`, `1px 6px`, `3px 8px`. `web/App.svelte:948`, `web/docs/ApiDocsView.svelte:413`, `web/docs/TableProfile.svelte:276` are representative. ~30-40 sites.

**Fix direction:** extend `--space-*` with sub-4px tokens (e.g., `--space-0h: 2px`, `--space-1h: 3px`) or convert to em-based units so they scale. Subset of the QOL-013 work.

---

## QOL-015 — Theme swatch CSS duplicated between AppearancePanel and TopBar

**Severity:** low · cosmetic
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/settings/AppearancePanel.svelte:58-61` and `web/shell/TopBar.svelte:116-119` both define swatch-preview gradients with hardcoded hex values per palette. Won't auto-update if theme.css is tweaked.

**Fix direction:** extract to `web/styles/_theme-swatches.css` keyed by `[data-swatch-theme="phosphor"]` etc., or use a small `<ThemeSwatch>` component that reads from `theme.css`.

---

## QOL-014 — Hardcoded `rgba(255,255,255,…)` highlight on dark assumption

**Severity:** medium · blocking · breaks light theme (beige)
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/ApiDocsView.svelte:473` uses `rgba(255, 255, 255, 0.08)` as a subtle highlight, assuming a dark background. On the beige (light) palette this becomes white-on-beige and looks wrong.

**Fix direction:** add `--highlight: rgba(255,255,255,0.08)` to dark themes and `rgba(0,0,0,0.06)` to beige in `theme.css`. Use `var(--highlight)` at the callsite.

---

## QOL-013 — Hardcoded `px` padding/margin throughout (~60-80 sites)

**Severity:** medium · BLOCKING for Phase 3 UI scaler
**Reported:** 2026-05-01 (pre-Phase-3 audit)

The UI scaler will multiply `:root` font-size (100/115/130/150%). Any spacing declared in raw `px` won't scale; the layout will skew on larger settings. Audit found ~60-80 sites mixing `var(--space-N)` with hardcoded `Npx` padding/margin (`web/App.svelte:886,895,906`, `web/docs/ApiDocsView.svelte:383,396,469`, `web/docs/try/VerbSafetyModal.svelte:64,56`, etc.).

**Fix direction:** convert all hardcoded padding/margin to either `var(--space-N)` tokens or em/rem units. Extend the `--space-*` scale with sub-4px tokens (cf. QOL-016) where needed. **Must land before the UI scaler ships.**

---

## QOL-012 — Hardcoded `font-size: Npx` throughout (~70-100 sites)

**Severity:** medium · BLOCKING for Phase 3 UI scaler
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`font-size: 11px / 12px / 14px / 22px / 10px` appear ~70-100 times across `web/App.svelte`, `web/docs/ApiDocsView.svelte`, `web/docs/ColumnProfile.svelte`, etc. Pixel-based font sizes won't multiply when the UI scaler bumps `:root` font-size — the user will get bigger margins around stubbornly-small text.

**Fix direction:** define a font-size scale in `web/styles/theme.css` (e.g., `--fs-xs: 0.625rem`, `--fs-sm: 0.6875rem`, `--fs-base: 0.75rem`, `--fs-lg: 0.875rem`, `--fs-xl: 1.375rem` — anchored to a 16px root) and sweep callsites. **Must land before the UI scaler ships.**

---

## QOL-011 — Modal overlays hardcode `rgba(0,0,0,…)` — won't theme on light beige

**Severity:** medium · BLOCKING for the beige theme
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/App.svelte:1023` (`rgba(0,0,0,0.55)`), `web/docs/try/VerbSafetyModal.svelte:43`, `web/shell/CommandPalette.svelte:292`, `web/docs/response/DataTable.svelte:479`. ~6-8 sites assume a dark backdrop.

**Fix direction:** add `--overlay-bg` to `theme.css` (dark themes: `rgba(0,0,0,0.55)`, beige: `rgba(0,0,0,0.2)` or similar). Use `var(--overlay-bg)` at all callsites.

---

## QOL-010 — Method badge colours hardcoded in ApiDocsView, shadowing theme tokens

**Severity:** high · BLOCKING for theme switcher
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/ApiDocsView.svelte:475-482` defines `.method-get`, `.method-post`, `.method-put`, `.method-delete`, `.method-patch`, `.method-options`, `.method-head`, `.method-trace` with literal hex values (`#6fbf73`, `#5c9cff`, `#ffb95c`, `#ffe066`, `#ff6868`, `#9a9a9a`). Theme.css already defines `--method-X-bg`/`--method-X-fg` per palette but these component rules override them — so switching themes won't update method badges.

**Fix direction:** replace each hardcoded rule with `background: var(--method-get-bg); color: var(--method-get-fg);` (etc.) and delete the hex literals. Verify each palette in `theme.css` actually defines all eight method colour pairs; add any missing ones.

---

## B-015 — Dead `request_history` table in SCHEMA_V1 (reverted feature artefact)

**Severity:** low · dead schema · no functional impact
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`server/indexer/sqlite.ts:280-291` defines `CREATE TABLE request_history` and a timestamp index. The Request History feature (Phase 2 item 8) was implemented, merged 2026-04-27, then reverted at the user's call. The table schema stayed behind. `tests/schema-migration.test.ts` includes it in the SCHEMA_V2 wipe list.

**Fix direction:** drop the `CREATE TABLE request_history` and its index from `SCHEMA_V1`. Remove from the wipe list in `tests/schema-migration.test.ts` and any other test fixture. Keep the `request_history` entry in `meta` table forward-migration drops list (defensive — won't error against existing DBs that have the table). Revisit if the History feature is ever resurrected.

---

## QOL-009 — PLAN.md "Distribution constraints" section reads as current but describes pre-pivot design

**Severity:** low · doc clarity
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`PLAN.md:115` (within the "Distribution constraints (from user)" heading) still describes DPAPI + `%APPDATA%` + `.bat`-launchers as the design. The "Pivot 2026-05-01" section above flags this as historical, but a reader who lands directly in the "Distribution constraints" section sees the pre-pivot design as if it were current.

**Fix direction:** add an inline note to the section header: e.g., `## Distribution constraints (original pre-pivot — see Pivot 2026-05-01)`. Or move the entire section into a "Historical design" appendix. The audit found no other stale Bun/DPAPI references — the pivot was otherwise surgical.

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

- **B-014** — Tree/Pretty checkboxes greyed out for moderately-sized JSON responses → `68b55c4` _fix(response): more permissive Tree/Pretty thresholds_ (200KB cap was tripping for typical /api/persons responses; bumped to 1MB and decoupled Pretty from the tokenize gate since JSON.stringify is cheap)
- **B-013** — count-link parent-filter nav clobbered by selectedPath effect → `5b6be84` _fix(response): count-link parent-filter nav_ (pre-dates this session; the selectedPath $effect unconditionally reset navFilter, racing the synchronous `selectedPath = p; navFilter = pid` writes from the count-link handler. Same shape as B-002. Reset retained for hiddenCols only; rail/breadcrumb handlers continue to clear navFilter explicitly)
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
