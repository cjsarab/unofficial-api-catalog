# Backlog

Discovered issues + quality-of-life items that aren't in scope for the active phase's plan. Each entry has a stable ID (`B-###` bug, `QOL-###` polish, `UX-###` design).

**Triage workflow:** discover → log here → triage by phase planning → move into a plan / spec when worked on → tick off below with the commit SHA.

Open items, newest at top.

---

## QOL-030 — Response-panel size thresholds duplicated as separate constants

**Severity:** low · cosmetic · deferred
**Reported:** 2026-05-01 (pre-Phase-3 audit)

`web/docs/response/tabs/RawTab.svelte:14,19` defines `HEAD_THRESHOLD_BYTES` and `TOKENIZE_MAX_BYTES`, both = `1024 * 1024`. Two named constants with identical values invite drift if either is later tuned without considering the other.

**Fix direction:** if they must move together, collapse to one `RESPONSE_SIZE_THRESHOLD`. If they're conceptually independent, keep both but move to `web/docs/response/constants.ts` and document the relationship.

(Left open in 2026-05-01 cleanup pass — cosmetic only; no code path actually requires divergent values today.)

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

## (closed items live below; moved here when shipped)

### Closed in the 2026-05-01 cleanup pass

A no-functional-change sweep ahead of Phase 3 UI-settings work. Three commits land the cleanup; smoke + 204/204 tests + clean typecheck at every checkpoint.

CSS tokenisation (`631f3e8` _refactor(css): tokenize hardcoded colours, font-size, and spacing_):
- **QOL-010** — Method badge colours hardcoded in ApiDocsView. Now uses `var(--method-X-{bg,fg})`; semantic tokens hoisted to a `:root` block so all four palettes render identically (preserves prior behaviour) and a future per-palette override is one block away.
- **QOL-011** — Modal overlays `rgba(0,0,0,…)`. Replaced with `var(--overlay-bg)`; beige gets a gentler 0.25 opacity instead of 0.55.
- **QOL-012** — ~70–100 hardcoded `font-size: Npx`. New `--fs-{xs,sm,base,md,lg,xl}` scale in rem; sweep done via a one-shot Node helper that only rewrites within `font-size:` declarations.
- **QOL-013** — ~60–80 hardcoded `px` padding/margin. `--space-*` scale converted to rem-based; new `--space-{0,1-5,2-5}` (2/6/10px) tokens for sub-4px gaps; sweep landed alongside QOL-012.
- **QOL-014** — Hardcoded `rgba(255,255,255,…)` highlight halo. Replaced with `var(--highlight)`; beige gets `rgba(0,0,0,0.06)` instead.
- **QOL-016** — Sub-4px micro-spacing drift. Subset of QOL-013 — addressed by the same sweep + new `--space-0/1-5/2-5` tokens.
- **QOL-017** — `var(--fg, #fallback)` hex fallbacks across 7 components. PowerShell sweep stripped them all; theme.css is the single source of truth.
- **QOL-020** — Heading sizes mixing rem + px. Folded into the `--fs-*` scale; new `--fs-h{1,2,3,4}` aliases give semantic names. The remaining ~15 odd-pixel headings (9/13/18/20px not on the scale) left raw — too rare to warrant scale tokens.

Web dedup + shared CSS (`33183ad` _refactor(web): consolidate shared CSS, lineage helpers, storage utilities_):
- **QOL-004** — `LastScanStatus` redefined in 4 places. Three Svelte files now import it from `server/indexer/index.ts` via the `@server` alias as a type-only import; server stays the single source.
- **QOL-006** — JsonTree `--tree-indent` magic-number coupling. `.chev width` and `.close padding-left` both reference a `--tree-indent: 14px` CSS var on `.node`.
- **QOL-008** — `_oldSchema` unused param. Dropped from `reprojectFormState`; the one call site + 11 tests updated.
- **QOL-015** — Theme swatch CSS duplicated. Extracted to `web/styles/theme-swatches.css`; AppearancePanel + TopBar both rely on the global rules.
- **QOL-018** — JsonTree + RawTab `:global(.tk-*)` rules duplicated. Extracted to `web/styles/json-syntax.css`.
- **QOL-019** — Repeated layout patterns (.pad / .glance-card / list-reset). **Declined.** Inspection showed `.pad` has different padding values per scope (`docs/.pad` is `var(--space-5) var(--space-6)`, `sidebar/.pad` is `var(--space-2) var(--space-2-5)`, `family-tree/.pad` is `var(--space-3) var(--space-4)`). Svelte's per-component scoping is preventing collisions. Extracting a global rule would either lose the contextual values or rename three classes — neither is worth the cleanup cost. Keeping the audit entry closed for traceability so a future audit doesn't re-flag.
- **QOL-021** — Lineage helpers (TOKEN_RE, splitExpression, prettyFieldPath) duplicated across ApiDocsView + ColumnProfile. Extracted to `web/lib/lineage.ts`. Renamed `splitExpr` → `splitExpression` for canonical naming.
- **QOL-022** — Four `acx:…:v1` localStorage keys without shared migration. Consolidated to `web/lib/storage.ts` with typed `getStored<T>` / `setStored<T>` and string variants; key constants exported from `STORAGE_KEYS`.
- **QOL-023** — `formatBytes` duplicated between App.svelte and `web/docs/response/format.ts`. Extended the response-panel one with GB support and now used in both places.

Server dedup + dead code (`0f459b0` _refactor(server): shared http helpers + countRows + drop dead schema_):
- **B-015** — Dead `request_history` table. Removed from SCHEMA_V1; SCHEMA_VERSION bumped 1 → 2; existing v1 DBs auto-cleaned via the migrate() drop list.
- **QOL-024** — Repeated `Response.json({ error }, { status })` shape. New `errorResponse(message, status, extra?)` in `server/lib/http.ts`; ~14 callsites swept across 6 route files (simple form via PowerShell regex, compound form via per-site Edit).
- **QOL-025** — `SELECT count(*) as c FROM <table>` boilerplate. New `countRows(db, table)` in sqlite.ts; 5 callsites swept.
- **QOL-026** — FTS5 virtual tables + 4 INSERT/DELETE triggers maintained but never queried. **Dropped** rather than wired in (preserves current search behaviour). SCHEMA bump claws back ~15% indexer write throughput.
- **QOL-027** — `typeof x !== "object" || x === null` guard repeated. New `isObject(x)` typed guard in `server/lib/http.ts`; 4 sites in `endpoint.ts` swept.
- **QOL-028** — HTTP status code constants. **Folded into QOL-024** — `errorResponse(msg, 400)` is the new pattern. Adding HTTP_BAD_REQUEST etc. would just rename `400` to `HTTP_BAD_REQUEST` everywhere — same effect, more verbose. Closing without explicit status constants.
- **QOL-029** — Picker timeout magic number. Replaced `5 * 60 * 1000` with named `DEFAULT_PICKER_TIMEOUT_MS` at top of `picker.ts`.

Doc clarity (in this commit):
- **QOL-009** — PLAN.md "Distribution constraints" reads as current. Section header retitled "original pre-pivot design (now obsolete)" with a callout box pointing to the Pivot 2026-05-01 section near the top.

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
