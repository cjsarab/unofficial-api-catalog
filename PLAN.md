# API Catalog Explorer — Design Plan

> Status: **Phase 1 complete** (browse + lineage + column & table profiles + global search). **Phase 2 complete** (items 1–7): plaintext secret store, environment profile manager, Ethos API key → JWT exchange, request proxy, Try panel UI with verb-safety modal, full Response Panel. Item 8 (Request History) was implemented and merged 2026-04-27 then reverted at the user's call as out of scope. **Backlog cleared 2026-04-29** — 9 items closed (B-001..B-004, QOL-001..QOL-003, UX-001, UX-002); see `BACKLOG.md` closed section. **Pivot 2026-05-01** — runtime moved from portable Bun to plain Node + npm; DPAPI replaced with plaintext secrets; app data moved from `%APPDATA%` to `./data/`. See "Pivot 2026-05-01" section below for the full delta. Next: Phase 3 — column basket, SQL paste, set-cover matcher, lineage graph, theme switcher UI.

## Pivot 2026-05-01 — Bun → Node, DPAPI → plaintext, APPDATA → ./data/

The "zero-install portable bundle" model (ship `bun.exe` + DPAPI-encrypted secrets in `%APPDATA%`) was replaced with a "clone-and-run" model. The user determined the bundle approach was overkill for the actual user population (the user themselves + a handful of trusted colleagues). The app is now a plain Node 22.5+ TypeScript project run via `tsx` — `npm install && npm run dev` from a fresh clone.

**What changed:**

- **Runtime**: Bun → Node 22.5+ LTS (24 in development). TypeScript runs via `tsx` (no precompile step for the server).
- **HTTP server**: `Bun.serve` → `@hono/node-server`'s `serve({ fetch, port })`. The existing `(req: Request) => Response` route handlers were unchanged — only the bootstrap in `server.ts` swapped.
- **SQLite driver**: `bun:sqlite` → `node:sqlite` (Node 22.5+ experimental builtin). FTS5 still bundled. A thin wrapper in `server/indexer/sqlite.ts` preserves the previous `db.query<T, A>(sql).get(...)` API so the ~50 callsites across the indexer + routes didn't need rewriting. node:sqlite is loaded via `createRequire` rather than a static import to work around a Vite 5 known-builtins gap.
- **Test runner**: `bun:test` → `vitest`. Same `describe/test/expect` shape — most files just needed an import-line swap.
- **Secrets**: DPAPI (`server/auth/dpapi.ts`) deleted. `server/auth/secrets.ts` rewritten to store values plaintext in `data/secrets.json`. The `SecretStore` interface is unchanged so every consumer (env store, Ethos auth, proxy) keeps working with no edits. Trust model is now "single-user localhost desktop app" — equivalent to a `.env` file in any other Node project.
- **App data location**: `%APPDATA%\api-catalog-explorer\` → repo-local `./data/`. `data/` is gitignored except for a `.gitkeep`. `secrets.json` is double-protected by an explicit pattern in `.gitignore`.
- **Distribution**: zip-with-bun-runtime model dropped. New flow is `git clone <repo> && npm install && npm run dev`. `launch.bat` and `dev.bat` are kept as Windows-friendly thin wrappers around `npm run start` / `npm run dev`. `setup.bat` is gone.
- **Bun.* call sites** in routes/validators (`Bun.file`, `Bun.spawn`, `Bun.version`, `import.meta.dir`) replaced with their Node equivalents (`fs/promises.readFile`, `child_process.spawn`, `process.version`, `dirname(fileURLToPath(import.meta.url))`).

**What didn't change:**

- All Svelte UI files. The frontend is unaware of the runtime swap.
- All route handlers under `server/routes/*.ts`. Same `(req: Request) => Response` Web-API shape works under Hono.
- All env/auth/proxy callers — they talk to `SecretStore` and `EnvironmentStore` interfaces, not to DPAPI directly.
- The catalog drop-in flow. Users still supply their own `APICatalog/` folder via the first-run wizard.
- The on-disk shape of `config.json`, `environments.json`, `index.sqlite`. Existing data from a `%APPDATA%` install can be moved into `./data/` to keep continuity (except `secrets.json`, whose old DPAPI ciphertexts are unreadable — re-enter API keys after the move).

**Test count**: 211 → 204 (deleted 7 DPAPI round-trip tests; rest of the suite unchanged in spirit, just the import path swapped).

**Affected paragraphs in this document** (read with the pivot in mind):
- "Architecture decision (locked in)" still describes the layout, but **runtime/shell** is Node + npm, not portable Bun. **Index** uses `node:sqlite`, not `bun:sqlite`. **Secrets** are plaintext in `./data/secrets.json`, not DPAPI.
- "Distribution" is now `git clone` + `npm install`, not a zip with `bun.exe` and `setup.bat`.
- "Try-APIs" — environment-profile API-key field is plaintext on disk; everything else (region, JWT exchange, verb safety) is unchanged.

## Context

A local app for the user and their global colleagues to explore Ellucian's API catalog. Ellucian recently redesigned their online API docs and the result is poor; they provide a downloadable zip of YAML OpenAPI specs as the source of truth.

The app needs to let users:
- Browse the catalog and search by API.
- View the documentation content rendered nicely.
- Match APIs on **lineage** (concept to be refined with user).
- Try APIs — query params, headers, with API keys stored safely on the user's machine.

Non-functional goals:
- Retro feel with strong UX and performance focus.
- Large catalog; app must ship *without* the YAMLs. Users download the Ellucian zip and drop it in themselves.
- Useful for direct colleagues (same institution) and global colleagues (different regions).

## Catalog shape (discovered in exploration)

Base path: `C:/Users/cjsar/Documents/api_catalog_explorer/APICatalog/`

- **Scale**: 4,377 YAML files, 736 MB on disk, OpenAPI 3.0.0.
- **Layout**: `APICatalog/{ProductFamily}APIs/{api-name}-{version}/{api-name}.yaml` — one self-contained spec per folder.
- **20 product families**. Volume-weighted:
  - BannerBusAPIs: 1,786
  - ColleagueWebNonEthosAPIs: 680
  - ColleagueEedmAPIs: 472
  - BannerEedmAPIs: 466
  - BannerErpAPIs: 368
  - CRMAdvanceEedmAPIs: 205, ColleagueWebEthosAPIs: 163, PowerCampusEedmAPIs: 57, DegreeWorksAPIs: 56, CRMRecruitEedmAPIs: 51, PowerCampusAPIs: 30, ColleagueSpecAPIs: 23, ColleagueBusAPIs: 5, PersonManagerAPIs: 4, BannerSpecAPIs: 3, ApplyAPIs: 2, EllDocumentMgmtAPIs: 2, MaestroAPIs: 2, ApplyEedmAPIs: 1, ExperienceAPIs: 1.
- **Self-contained**: zero external `$ref`s across files — lazy per-spec loading is safe.
- **Rich metadata at `info:`**:
  - `x-source-system` — banner | colleague | apply | powercampus | crm-recruit | degreeworks | …
  - `x-source-domain` — Student | Financial Aid | Finance | Human Resources | Recruitment | …
  - `x-source-title` — human resource name.
  - `x-api-type` — ethos | other.
  - `x-release-status` — ga | beta.
  - `x-audience`.
- **Lineage is two distinct datasets** on fields — both frequently co-present:
  - `x-lineageLookupReferenceObject` — API-level edge in EEDM specs (e.g. `educational-institutions`, `academic-programs`); DB-table pointer in Bus specs (e.g. `gtvzipc`, `stvnatn`).
  - `x-lineageReferenceObject` — physical-schema pointer to the source DB column. Banner-style (`SPRIDEN_ID`), Colleague-style (`FA.YEAR`), `unsupported` / `derived` sentinels, or a small DSL (see Lineage expression language section below). Densely annotated in Bus/Erp specs (e.g. `vendor-details-2.0.0` has 406 hits).
  - Implication: two lineage audiences served cleanly — integration devs (API-to-API graph) and data engineers (column provenance via the column profile + migration flow).
- **Security (on every spec)**: dominant scheme is `EthosIntegrationBearer` (HTTP bearer token) plus a required versioning `accept` header (`application/vnd.hedtech.integration.vN+json`).
- **Servers (on every spec)**: multi-region (`elluciancloud.com`/`.ca`/`.ie`/`.com.au`) plus `{server_url}` custom in Ethos specs — matches the "global colleagues" goal.

## Hard requirement — column as first-class citizen

Physical columns (e.g. `SPRIDEN_ID`, `FA.YEAR`) are a primary user-facing entity, not just metadata:
- **Search**: users must be able to type `SPRIDEN_ID` and get a hit list of every API that uses it.
- **Click-through**: any column displayed in an API detail view must be clickable and surface every other API that touches the same column.
- Design consequence: the indexer must emit a **column → [{api_id, field_path, source_system}]** inverted index alongside the per-API metadata. The column-profile view is a destination route (`/columns/:name`), not just a filter. Likely worth grouping by table prefix (`SPRIDEN`, `TBBACCT`, `VAL`) as a secondary navigation.

## Lineage expression language (empirical)

`x-lineageReferenceObject` is a small, loosely-structured DSL, not plain column names. Forms observed:

**Sentinels:**
- `unsupported` — vendor cannot express lineage
- `derived` — computed by the API layer
- `caseInsensitiveRg` — search-parameter marker (appears on query params, not data fields)

**Expression forms:**
- Bare column: `SPRIDEN_ID`, `FA.YEAR`, `TBBACCT_BILL_CODE`
- Column with explicit table: `CAT.DESC(CATALOGS)`, `GTVLGSX_GUID(GTVLGSX)`
- Alternatives via `or`: `LDM.GUID.ID(OTHER.DEGREES) or LDM.GUID.ID(OTHER.CCDS)`
- Where clauses: `STVBLDG_DESC(STVBLDG) where SLBBLDG_BLDG_CODE = STVBLDG_CODE`; also `... field where X='literal'`
- Oracle-style concatenation: `(SOBODTE_TERM_CODE||'(OLR)'||SOBODTE_INSM_CODE)`
- Tuples (composite keys): `'(CONTACT.ACTUAL.DATE, CONTACT.ACTUAL.TIME)'`
- Data-quality hazards: leading whitespace (`' PLD.HOURS'`), unbalanced parens (`'CSM.START.DATE, CSM.START.TIME)'`), informal free-text (`'CSM.MONDAY, etc)'`).

`x-lineageLookupReferenceObject` is simpler but **context-dependent**:
- In EEDM specs → API resource name (e.g. `educational-institutions`) — API-to-API edge.
- In non-EEDM Bus specs → Banner/Colleague DB table name (e.g. `gtvzipc`, `stvnatn`) — API-to-table edge.

**Indexer implication:** tolerant tokenizer that (a) recognises sentinels, (b) extracts all identifier tokens matching Banner (`[A-Z][A-Z0-9_]*`) and Colleague (`[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+`) conventions, (c) records explicit `(TABLE)` contexts, (d) preserves the raw string for display, (e) tolerates whitespace and unbalanced punctuation. Each index entry: `{column, api_id, field_path, raw_expression, kind: column|lookup|tuple|derived|unsupported|search-marker, source_system}`.

## Hard constraints (from user)

- **Partial catalogs must work.** A user may drop only a subset of product-family folders (e.g. just `BannerBusAPIs/` and `BannerEedmAPIs/`), or even a subset of individual API folders within a family. The index/search/lineage features must degrade gracefully — unresolved lineage edges (e.g. reference to an EEDM resource whose folder isn't present) must not crash the app; they should render as "not installed" rather than broken links. The app is also expected to be robust enough to handle the full catalog.

## Distribution constraints (from user)

- **Windows-only** target for launch (single OS; use DPAPI (`CryptProtectData`) for at-rest secret encryption stored in our own `secrets.json`, `%APPDATA%` for local data, `.bat` launchers, CRLF tolerant).
- **No per-user installation**. Users can't (or won't) install Node. Users won't pay for signing certs. No self-hosted server option.
- **Corporate IT blocks arbitrary `.exe` files** — any binary requires IT approval via source-code review, done once per release.
- Repo hosting (public github.com vs. an internal GitHub/GitLab/Bitbucket) is unresolved and IT-dependent; the plan is hosting-agnostic.

**Design consequence — zero-install portable bundle**: ship a zip containing the official Bun runtime + our app source. The user unzips and double-clicks `launch.bat`; Bun serves a local HTTP server + Svelte SPA and opens the default Windows browser. IT reviews readable TypeScript plus a well-known open-source runtime once. No per-machine install, no paid cert, no hosted infrastructure.

## Target users (from user)

Three personas, in priority order:

1. **PL/SQL veterans (primary)** — deep Banner/Colleague DB knowledge. Former Toad-over-ODBC users. Know tables and columns intimately. New to REST/Node/Postman and likely don't have Node installed. Primary job-to-be-done: "Which APIs map to which tables and columns?" (answer migration from direct DB access to API calls) and "How does this data come back now?" (response shape & sample data). Implication: **install friction must be low (single binary / double-click); column search is THE killer feature, not a nice-to-have; response visualisation matters as much as request building.**
2. **API-native developers** — Postman-comfortable, want efficient exploration and testing across the full catalog.
3. **Discovery / non-Banner staff** — browsing "what's available" — casual exploration.

Design principles that fall out:
- Muscle-memory friendly for Toad users: left pane = catalog tree + column dictionary, centre = docs + request, bottom/right = response grid. Keyboard-first where reasonable.
- The column-lookup flow ("where does `SPBPERS_SEX` come from?") is a first-class primary task, not a secondary filter.
- Rendered responses should feel like a SQL result grid when the shape permits, not just raw JSON.

## Architecture decision (locked in)

- **Runtime & shell**: portable Bun runtime (~50 MB, single `bun.exe`), shipped inside the zip alongside app code. No installation; user unzips and runs.
- **Frontend**: Svelte (compiled to static assets; small runtime, fast hydration, good fit for retro UI + performance goals).
- **Backend**: Bun's built-in `Bun.serve()` HTTP server on a random free local port. Launcher starts the server and auto-opens the default Windows browser.
- **Proxy**: server proxies all outbound calls to Ellucian Ethos — solves CORS, allows custom auth headers, enables request/response logging.
- **Index**: SQLite via Bun's built-in `bun:sqlite`, with **FTS5 virtual tables** for full-text search across spec titles/descriptions and column names.
- **Indexing**: parallel YAML parsing on first run using Bun's `Worker` threads (one per CPU core). Subsequent runs: mtime-diff to re-parse only changed files. Progress UI during indexing.
- **Secrets**: Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`, small `bun:ffi` wrapper around `crypt32.dll`). Ciphertexts stored in `%APPDATA%\api-catalog-explorer\secrets.json` — entirely in-app, nothing visible in `Manage Windows Credentials`. API keys scoped per-environment (e.g. `apply-prod`, `banner-test`). Keys never written to disk or logs in plaintext.
- **Catalog path**: first-run folder picker; choice stored in `%APPDATA%\api-catalog-explorer\config.json`. Partial catalogs detected and surfaced ("14 of 20 families installed — Lineage edges to missing families rendered as 'not installed'").

## Distribution

- Deliverable: `api-catalog-explorer.zip` (~50–70 MB)
  - Contents: `bun.exe`, `launch.bat`, `server.js` (bundled + minified but readable), `web/` (static Svelte assets), `README.md`, `LICENSE`.
- User flow: unzip → double-click `launch.bat` → browser opens to `http://localhost:RANDOM_PORT`.
- Source repo on GitHub (internal-vs-public TBD with IT) for code review.

## UI shell (locked in)

**Layout**: Toad-style with response underneath, full width.

```
┌──────────────────────────────────────────────────────────────┐
│ top bar · search · env selector                              │
├──────────┬─────────────────────┬─────────────────────────────┤
│ families │   API documentation │   Try (request builder)     │
│  + col   │                     │                             │
│  dict    │                     │                             │
├──────────┴─────────────────────┴─────────────────────────────┤
│ Response · tabs: raw · table · headers · timing              │
│   (full width, draggable split with the row above)           │
├──────────────────────────────────────────────────────────────┤
│ status bar · index count · last response                     │
└──────────────────────────────────────────────────────────────┘
```

**Resizable + movable**:
- All dividers draggable (four of them: L-M, M-R, Top-Response, Tree-ColDict vertically).
- Users can collapse any panel. Ctrl+B / Ctrl+. / Ctrl+\ toggle left / right / response.
- User-chosen sizes persisted in `%APPDATA%/api-catalog-explorer/layout.json`.
- Preset layouts: *Default*, *Reader* (docs wide, both side panels hidden), *Tryer* (Try wide, docs narrow), *Response-focus* (Response 70%). One-click switch.
- Stretch: panel reorder (Try to the left, etc.) via drag. Not v1 — note as future.

**Docs panel breathing room**:
- Middle panel auto-widens when Try is collapsed (default when no request in flight).
- "Reader mode" shortcut hides left + right, docs go full-width.
- Long descriptions use ellipsis with click-to-expand where pragmatic; full rendering always available.

**Windows-native keyboard conventions** (no Mac symbols anywhere):
- **F5** = Send request (Toad muscle memory — primary send).
- **Ctrl+Enter** = Send request (modern alternative).
- **Ctrl+K** = global search / command palette.
- **Ctrl+B** = toggle left sidebar; **Ctrl+.** = toggle Try panel; **Ctrl+\\** = toggle response.
- **Ctrl+Shift+C** = focus column dictionary; **Ctrl+Shift+F** = focus family tree.
- **F1** = help.
- **Ctrl+S** = save current request as a snippet.

## Response panel behaviours (locked in)

- Tabs: **raw** (syntax-highlighted JSON/XML), **table** (array responses as a SQL-style grid — first-class for PL/SQL vets), **headers**, **timing**.
- Response history: disclosure showing last N sends for the current endpoint; click to compare before/after in a side-by-side diff.
- Empty state: row collapses to the divider until first send.
- Pop-out: open response in a second browser window / overlay for close inspection.
- Copy · Save · Rerun · Pop out actions on every response.

## Column profile page (locked in)

Route: `/columns/:name` (e.g. `/columns/SPRIDEN_ID`). Reached by clicking any column token in the left dictionary, in any docs page, or in any lineage expression.

- **Header**: column name, inferred source system and parent table (table clickable → table profile), total occurrences, list of domains the column appears under.
- **At-a-glance panel**: counts by family, by status (ga/beta), by domain — answers "how widely surfaced is this?" in one glance.
- **Main list**: every API that references the column. Each row: `family / resource / version`, status + domain tag, field path inside the response, raw lineage expression. Every token inside the expression (e.g. `SPBPERS_PIDM`) is a clickable link to its own column profile.
- **Filters**: family / source-system / status / expression-kind. Needed for high-cardinality columns (e.g. `SPRIDEN_ID` with 112 hits).
- **Other columns on table** (right): the rest of the table's columns ranked by occurrence; jumps to each column's profile.
- **Co-occurs with** (right): the columns most frequently appearing alongside this one in the same API responses — sets up the migration workflow.

## Migration workflow (locked in)

Route: `/migrate`. Reached via top-bar "Migrate" button (`Ctrl+M`) or via the column basket dock.

**Two on-ramps:**
1. **Paste SQL** — textarea; "Extract columns" parses PL/SQL via tolerant regex for Banner (`[A-Z][A-Z0-9_]+`) and Colleague (`[A-Z]+(\.[A-Z]+)+`) identifiers; copes with aliases (`s.SPRIDEN_ID` → `SPRIDEN_ID`), CTEs, quoted identifiers.
2. **Build column basket** — persistent dock that follows you between pages. Grows from: `+` button on any column in docs or column profile; "add all columns on this table" from the table profile; drag-and-drop chips; auto-fill from SQL paste. Saved baskets persisted to `%APPDATA%/api-catalog-explorer/baskets/`.

**Matching algorithm:**
- Indexer precomputes a `column → api_id` inverted index.
- At query time: classic **set-cover problem**, solved with greedy largest-coverage-first. Fast, good enough for 4,377 specs.
- Results presented as **ranked API sets**: minimum number of APIs that together cover the basket.
- Ranking: fewer APIs first, then prefer same family/domain (fewer source-system hops), then prefer `ga` over `beta`.

**Output for each suggested set:**
- The APIs with their individual coverage list (which columns each contributes).
- **Join hints**: if two or more chosen APIs share a column (e.g. both return `SPRIDEN_ID`), UI surfaces it as "join on this to stitch results".
- **Copy as code**: generates a recipe (TypeScript / Python / PowerShell) that chains the calls.
- **Gaps in red**: columns that match zero APIs render in a warning panel with next steps — drop from basket, check for a missing family (partial catalog), or file as a gap with Ellucian.

## Lineage graph (locked in)

Route: `/lineage/:family/:name/:version`. Reached from the API detail page ("Lineage" tab) or by clicking any API in a column profile / migration recipe.

- **Default layout**: three columns — upstream (APIs referencing this) · focus (centre) · downstream (APIs this references). Dense, scannable, stable.
- **Alternative layouts** (toggle in toolbar): force-directed (Cytoscape.js) and hierarchical for users who want topological visualisation.
- **Edges labelled with both field path and column token**: e.g. `.demographics.nationality — SPRIDEN_NATN_CODE`. Field path for API devs, column for PL/SQL vets.
- **Controls**: hop distance (1/2/3/all), direction filter (upstream/downstream/both), filters by family / domain / status, view toggle (graph ↔ list).
- **Partial-catalog handling**: edges to uninstalled APIs render dashed + amber with "install family to resolve" hint. Never a silent broken link.
- **Exports**: adjacency-as-CSV (spreadsheet), `.dot` (Graphviz), JSON.
- **Edge source**:
  - `x-lineageLookupReferenceObject` in EEDM specs → API-to-API edge.
  - `x-lineageLookupReferenceObject` in Bus specs → API-to-DB-table edge (rendered on the table profile page, accessed via click-through).

## Table profile page (locked in — same pattern as column profile)

Route: `/tables/:name` (e.g. `/tables/SPRIDEN`, `/tables/gtvzipc`).

- **Header**: table name, source system (Banner/Colleague), total column count, total occurrence count across APIs.
- **Columns on this table**: ranked list; each row links to its column profile.
- **APIs referencing this table directly** (via `x-lineageLookupReferenceObject` in Bus specs): list with the field that creates the reference.
- **APIs using any column on this table** (aggregated across all columns): ranked by column count — useful when you want the "fullest-coverage" API for a table.

## Theme & aesthetic (locked in)

- **Default theme**: phosphor green on near-black. Monospace throughout. Subtle phosphor glow on headers / focused elements. No scanlines or CRT effects by default.
- **Theme system**: CSS custom-property tokens (palette + fonts + spacing scale) under root selectors. Switching a theme is a one-attribute flip (`data-theme="amber"` etc.). Zero-runtime overhead.
- **Shipped palettes**: `phosphor` (green, default), `amber` (amber CRT), `dos` (Turbo blue), `beige` (IBM print). Users can add custom palettes via a JSON file in `%APPDATA%/api-catalog-explorer/themes/`.
- **CRT effects are user-configurable** via the Settings → Appearance panel with live preview:
  - Scanlines overlay (off / subtle / visible / heavy)
  - Text glow (off / subtle / medium / heavy)
  - Barrel curvature (off / subtle / strong) — SVG filter, opt-in
  - Chromatic aberration (off / subtle / strong) — opt-in
  - Flicker (off / subtle / noticeable) — opt-in
  - Background noise (off / very subtle / subtle) — opt-in
- **Preferences** persisted to `%APPDATA%/api-catalog-explorer/theme.json`.
- **Theme switcher** also accessible via `Ctrl+Shift+P` command palette → "Theme: …".
- Settings UI uses standard form controls styled within the current theme — no separate "settings theme".

## Try-APIs (locked in)

- **Environment profiles** (tenant-level, shared across all APIs). Stored in `%APPDATA%\api-catalog-explorer\environments.json`; secrets DPAPI-encrypted in a sibling `secrets.json`, never on disk plaintext.
- **Per-profile fields**: name, production flag, Ellucian API key (DPAPI-encrypted in the sibling `secrets.json`). Per-request headers live on the Try panel — environments carry credentials + connection, not content negotiation. The `production` flag is the sole safety setting — when true, the Try panel confirms non-GET requests.
- **Region is workspace-level, not per-env**: stored in `config.json` as `region: "us" | "ca" | "eu" | "ap"` (US / Canada / Europe / Asia-Pacific). One value for all envs — all tenants a given user works with are in the same region. The base URL and auth URL are derived from region: `https://integrate.elluciancloud.{com|ca|ie|com.au}` and `${baseUrl}/auth` respectively.
- **Top-bar selector**: one-click switch between profiles. Red dot indicator on production envs.
- **Auth**:
  - **Ellucian Ethos Integration auth** — server sends the tenant's API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth` (region resolved from workspace-level `config.json`), receives a plaintext JWT in the response body, caches in RAM for TTL - 60 s, refreshes on 401, proxies calls with `Authorization: Bearer <jwt>`. API key is required per env; there is no client_id/client_secret pair.
  - **Test connection** button pings the auth endpoint; reports token acquisition time; does not touch data.
- **Verb safety**: confirm POST/PUT/PATCH/DELETE only on envs marked `production`. Confirm modal shows method + URL + redacted body + "Copy as curl" + Send/Cancel. Shift+F5 skips the dialog for the current request. Other envs send without prompting; env badges (red/amber/grey) provide the visual cue.
- **Request builder form**: schema-driven — reads the endpoint's OpenAPI schema and renders typed inputs (enums as dropdowns, dates as pickers, UUIDs with validators, arrays as chips). Toggle for raw JSON editor.

## Catalog drop-in flow (locked in)

**First run:**
- Launcher opens the browser to a welcome screen.
- Ask the user to point at the `APICatalog` folder. Native Windows folder dialog (via small PowerShell shell-out using `FolderBrowserDialog`), or drag the folder onto the window, or paste a path.
- Live validation before confirmation: folder exists, contains `*APIs/` subdirs, contains YAMLs, first YAML parses as OpenAPI 3.x. Reports which families are found vs. missing.
- Save to `%APPDATA%\api-catalog-explorer\config.json` (also stores last N recent paths for recovery).

**Recovery when path becomes invalid:**
- First-run wizard re-appears, pre-populated with probable locations: sibling folders of the old path, Documents, Downloads, Desktop, recent paths.
- Detect pointed-at-subfolder and suggest the parent.
- Detect zip and offer to unzip.
- Never fail silently — always an actionable next step.

**Re-selection paths in normal use:**
- Settings → Catalog (`Change…` button).
- Status-bar path is clickable.
- Command palette (`Ctrl+K` → "Change catalog folder…" / "Re-scan catalog").

**Partial catalogs (the common case):**
- Validation counts present vs. expected families (the 20 known `*APIs/` names) and reports "n of 20 families installed".
- Lineage edges to uninstalled resources render amber-dashed with "install family to resolve".
- Status bar shows `◇ n families not installed`, clickable to Settings → Catalog with gaps highlighted.
- No error — just concrete next steps.

**Mid-session changes**: `fs.watch` on the catalog root; a non-blocking toast appears if files vanish or new ones arrive. User chooses whether to re-scan.

**Indexing Notes panel**: non-fatal issues during parsing (malformed YAML, odd filenames) collected here with per-file diagnostic and retry. Index still builds for everything that parsed.

## Indexer pipeline (locked in)

- **On launch**: walk catalog root for `*.yaml`. Compute mtime-based delta against SQLite `files` table. Queue changed/new files.
- **Parallel parse**: Bun `Worker` pool sized to `navigator.hardwareConcurrency`. Each worker parses YAML, extracts:
  - Spec-level metadata (title, description, version, family, x-source-system, x-source-domain, x-source-title, x-api-type, x-release-status, x-audience).
  - Endpoints (path, method, summary, parameters, request/response schema refs).
  - Fields + lineage tokens (`x-lineageLookupReferenceObject` + `x-lineageReferenceObject` via tolerant tokenizer — handles sentinels, `or` alternatives, `where` clauses, `||` concatenation, tuples, informal free text, leading whitespace).
- **SQLite schema**:
  - `apis` (id, family, resource, version, title, description, source_system, source_domain, source_title, api_type, release_status, audience, file_path, mtime, indexed_at).
  - `endpoints` (api_id, path, method, summary, operation_id, schema_json).
  - `columns` (column_name, table_name, source_system, api_id, endpoint_id, field_path, raw_expression, kind).
  - `lineage_edges` (from_api_id, to_kind, to_ref).
  - `api_fts` (FTS5 over title + description + tags + source-domain).
  - `columns_fts` (FTS5 over column names, trigram-tokenized for fuzzy matching).
  - `files` (path, mtime, size, last_indexed, parse_status, error).
- **Progress pushed to UI** over a WebSocket: per-file progress + ETA + files/sec.
- **First-run estimate**: ~55 s for full catalog on a 4-core Windows machine. Subsequent launches < 1 s when nothing changed.
- **Schema migrations**: if app version bump changes the index schema, detect and wipe-rebuild in place.

## Search / command palette (locked in)

- **Global search** (top bar, always visible): fuzzy-scans across APIs, columns, tables, lineage edges. Ranks by: exact-match → prefix → trigram → popularity (use count). Inline filters: `fam:banner-bus`, `sys:colleague`, `dom:finance`, `status:beta`, `col:SPRIDEN_*`.
- **Command palette** (`Ctrl+K`): same search + commands. Commands include:
  - Navigation: `Go to column…`, `Go to API…`, `Go to family…`, `Go to table…`.
  - Catalog: `Change catalog folder…`, `Re-scan catalog`, `Show indexing notes`.
  - Try: `Switch environment: <name>`.
  - Appearance: `Theme: <name>`, `Scanlines: on/off`, `Reader mode`.
  - Import/export: `Export basket as CSV`, `Export index as JSON`.
- **Keyboard-first**: arrow keys + Enter; Esc closes. No mouse required.
- **Recent items** (when palette opened with empty query): last N items visited across APIs, columns, tables.

## Implementation phasing

A three-phase build so the tool delivers value early. Each phase is releasable on its own.

**Phase 1 — MVP for the PL/SQL vets** (the column-workflow crowd)
- Project scaffolding: Bun + Svelte + `bun:sqlite` + DPAPI FFI + launcher script.
- Catalog drop-in (first-run wizard, native folder picker, config persistence, validation).
- Indexer (walk, parse, SQLite writes, progress UI, mtime re-scan, indexing notes).
- Lineage tokenizer with full grammar coverage (sentinels, `or`, `where`, `||`, tuples, dirty-text tolerance).
- UI shell (Toad-style layout, resizable panels, Windows keys, status bar, phosphor-green theme).
- Family tree + column dictionary on left sidebar.
- API docs view (middle pane).
- Column profile page with filters, co-occurs, other-columns-on-table.
- Table profile page.
- Global search + command palette (Ctrl+K).
- Partial-catalog detection + recovery flows.

**Phase 2 — Real API calls for the dev crowd**
- Environment profile manager (Settings → Environments).
- Ellucian API key → JWT exchange (POST /auth) + token caching + refresh.
- Try panel (schema-driven form + raw JSON toggle).
- Response panel (full-width under, raw/table/headers/timing tabs).
- Verb safety modal (confirm non-GET on prod envs).
- Default-headers machinery + `Accept: application/vnd.hedtech.integration.vN+json`.

**Phase 3 — The migration killer-feature + polish**
- Column basket (persistent dock, drag/add/remove).
- SQL paste + tolerant column extractor.
- Set-cover matcher + ranked API sets + join hints + gap panel.
- "Copy as code" recipe generation (TypeScript / Python / PowerShell).
- API lineage graph (columns layout default, Cytoscape for force/hierarchy views, list-view toggle, exports).
- Theme switcher UI with all four palettes + CRT effect controls + live preview.
- Preset layouts (Default / Reader / Tryer / Response-focus).

## Verification — how to test end-to-end

Assume a `fixtures/APICatalog/` subset of ~50 specs is checked into the repo for tests (NOT the full 4,377 — just representative samples: one from each family + known-difficult lineage expressions from `persons`, `academic-catalogs`, `educational-institutions`).

**Unit tests** (Bun's built-in test runner):
- `tokenizer.test.ts` — every sample of `x-lineageReferenceObject` and `x-lineageLookupReferenceObject` from the real catalog (including the dirty-data cases: `' PLD.HOURS'`, `'CSM.MONDAY, etc)'`, `GTVLGSX_GUID(GTVLGSX) where SPBPERS_SEX = GTVLGSX_CODE`, `(SOBODTE_TERM_CODE||'(OLR)'||SOBODTE_INSM_CODE)`).
- `setcover.test.ts` — greedy matcher on fabricated baskets; asserts minimum-API-set output matches known answers.
- `validator.test.ts` — catalog-path validator accepts good folders, rejects/reports bad ones (empty, subfolder-pointed, non-YAML, zip).
- `secrets.test.ts` — round-trip encrypt/decrypt of a fake secret via Windows DPAPI; ciphertexts stored in our own JSON file, never visible outside the app; asserts never-persisted-plaintext on disk.

**Integration tests**:
- Spin up Bun server against `fixtures/APICatalog/`. Assert: index built, `/columns/SPRIDEN_ID` returns correct API list, `/migrate` with a scripted basket returns expected ranked sets.
- Mock Ethos auth endpoint (simple Bun handler) + a fake API endpoint. Save an environment profile, send a GET, assert bearer-token-attached proxy request + correct response passthrough.

**End-to-end smoke test** (Playwright against the running app in Chromium):
1. `bun run launch` — app starts, browser opens to welcome.
2. Point at `fixtures/APICatalog/`. Progress UI completes.
3. Search for `SPRIDEN_ID`; verify column profile loads with N expected APIs.
4. Click first API; verify docs render; verify middle column shows fields with lineage tokens clickable.
5. Open the Try panel; send a request against the mocked Ethos; verify response appears in the bottom panel.
6. Clear config; relaunch; confirm first-run wizard re-appears.
7. Switch theme to amber; verify palette change persists after reload.

**Manual acceptance** (against the real 4,377-spec catalog):
- First-run full index completes in < 2 minutes on a 4-core Windows laptop.
- Warm re-launch completes in < 2 seconds.
- Search typing latency < 20 ms per keystroke with FTS5.
- UI remains responsive during indexing (workers handle parsing off the main thread).

## Critical files to create

Top of tree (`api-catalog-explorer/`):
- `launch.bat` — entrypoint; invokes `bun.exe server.ts` with a free port.
- `bun.exe` — portable Bun runtime from official release.
- `server.ts` — Bun HTTP server entry: serves static web, proxies Ethos calls, runs indexer.
- `src/indexer/walker.ts` — fs walker + mtime diff.
- `src/indexer/parser.ts` — YAML + spec metadata extractor.
- `src/indexer/tokenizer.ts` — lineage-expression grammar + tolerant extractor.
- `src/indexer/sqlite.ts` — schema + migrations + FTS5 setup.
- `server/auth/ethos.ts` — Ellucian API-key → JWT exchange against `/auth` + token cache.
- `server/auth/dpapi.ts` — Windows DPAPI FFI wrapper (`CryptProtectData` / `CryptUnprotectData` against `crypt32.dll`).
- `server/auth/secrets.ts` — generic key/value secret store on top of DPAPI; persists base64 ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` via atomic tmp+rename writes.
- `src/proxy/ethos.ts` — request forwarding with auth + default headers.
- `src/migration/setcover.ts` — greedy minimum API-set solver.
- `src/validation/catalog.ts` — folder structure validator + recovery probes.
- `web/` (Svelte 5 + Vite, custom History-API routing — **not** SvelteKit):
  - `web/App.svelte` — root component, holds state + route dispatch.
  - `web/shell/` — `Shell.svelte`, `TopBar.svelte`, `StatusBar.svelte`, `CommandPalette.svelte`, `Splitter.svelte`, etc.
  - `web/sidebar/` — `Sidebar.svelte`, `FamilyTree.svelte`, `ColumnDict.svelte`, `TableList.svelte`.
  - `web/docs/` — `ApiDocsView.svelte`, `ColumnProfile.svelte`, `TableProfile.svelte`.
  - `web/settings/` — `SettingsView.svelte` (section-aware shell), `EnvironmentsPanel.svelte`, `AppearancePanel.svelte`, `CatalogPanel.svelte`.
  - `web/styles/theme.css` — CSS variable tokens per theme (`phosphor` / `amber` / `dos` / `beige`); CRT effect layers will live here too.

## Implementation notes (captured during build)

### Version handling (confirmed)

Same resource typically has multiple versions in the catalog (e.g. `academic-catalogs` has 6.0.0 and 6.1.0; `academic-periods` has 8.0.0, 16.0.0, 16.1.0). The UI must:

- Show **a single entry per resource** in the family tree (one "academic-catalogs" row, not three).
- Provide a **version dropdown** in the API docs header, listing every available version for that resource with its `x-release-status` badge (e.g. "6.1.0 · ga", "15.2.0 · ga", "16.0.0 · beta"). Default to the newest `ga` (fall back to newest of any status when none are `ga`).
- When a user arrives at `/api/:family/:name` without a version, route-resolve to the default version and update the URL.
- **Version-diff view** (stretch): side-by-side comparison of two versions' schemas, highlighting added/removed/changed fields. Not v1; note for Phase 3 polish.

### Landing view (after indexing completes)

When the user has a valid catalog and index but hasn't opened an API yet, the middle pane shows a **catalog overview**:

- Headline stats (APIs, endpoints, columns, lineage edges).
- Grid of top families with counts + a "browse" link into each.
- Top 10 columns (click-through to column profile).
- Top 10 tables (click-through to table profile).
- "Recently viewed" list once history exists.

This replaces the current "Hello, catalog" scaffolding page.

### Status bar (confirmed)

Bottom of the shell, always visible. Left: indexed API count · families fraction (e.g. `20/20`) · short catalog path. Right: active env profile · last response status & duration (once Try is wired).

### Left sidebar organisation (confirmed)

- **Three stacked sections** top-to-bottom: Families · Columns · Tables.
- Draggable vertical splitters between them so users can grow whichever section they're working in.
- Each section has its own collapse chevron; state persists in the same `acx:layout:v1` localStorage blob.
- All three visible by default so cross-reference (e.g. "which column is on this table?") doesn't need a click.

### Column dictionary navigation (confirmed)

- A filter input pinned to the top of the section.
- When the input is **empty**: show columns grouped by inferred table prefix (SPRIDEN, TBBACCT, VAL, LDM, …) as collapsible top-level rows with per-group column counts.
- When the input has a **query**: switch to a flat, virtualised alphabetical list filtered by fuzzy match across column names.
- Virtualisation is mandatory (18,350 distinct columns); render only visible rows with overscan.

### Layout persistence

User-chosen panel sizes and collapse states persist to browser `localStorage` under `acx:layout:v1`. The plan mentioned `%APPDATA%\api-catalog-explorer\layout.json` on the server — `localStorage` covers the single-user single-device case and is simpler. Server-side persistence can be added later if we need layout to follow the user across browsers.

## Phase 1 — shipped

All ten Phase-1 tasks are done. Summary of what works end-to-end as of the end of this session:

- **Zero-install launch**: `launch.bat` downloads `bun.exe` on first run; subsequent launches start the server on fixed port **5757** and open the default Windows browser. Clean shutdown handlers close the SQLite handle on SIGINT/SIGTERM/SIGHUP/uncaught exceptions so WAL is checkpointed properly.
- **First-run wizard**: native IFileDialog folder picker (modern Windows style) via `server/validation/pick-folder.ps1`, live validation preview, recent-paths, progress bar over Server-Sent Events during indexing, graceful handling of zip-file-mistakes, subfolder-mistakes, and missing paths.
- **Indexer**: walker + tolerant YAML parser (handles Ellucian's `\<NL>` line-continuation quirk and duplicate-key specs), full lineage tokenizer covering the observed DSL (sentinels, bare columns, table-qualified, `or`-alternatives, `where`-clauses, `||`-concatenation, tuples, dirty-text), SQLite schema with FTS5 tables (not yet queried — dead infrastructure, see known issues), stale-file cleanup on re-scan, `/api/index/clear` reset endpoint. ~4,377 specs index in ~2 minutes serial; incremental re-scan of an unchanged catalog is ~3 s.
- **UI shell**: Toad-style layout with resizable splitters, four themes (phosphor/amber/dos/beige) with live-switching, keyboard shortcuts (Ctrl+B/./\\, F1 help, Ctrl+K palette), layout persisted to localStorage, browser back/forward works via History API, deep URLs bookmarkable.
- **Sidebar**: three stacked sections (Families · Columns · Tables), each with its own filter. Column dictionary groups by table prefix when idle, switches to flat fuzzy list when typing. Families filter collapses the tree to a flat cross-family hit list.
- **API docs view**: version dropdown (defaults to newest ga), three tabs (Endpoints · Fields & lineage · API references), HTTP method badges with semantic colours + theme-safe borders, prettified field paths, clickable column/table tokens inside lineage expressions.
- **Column profile**: header with clickable inferred table, at-a-glance tiles (families · status · domains), family/status/domain filters, API list with clickable expressions, "Other columns on TABLE" and "Co-occurs with" sidebars (the migration-killer feature).
- **Table profile**: header with guessed source system, same at-a-glance pattern, API list with filters, columns-on-table sidebar.
- **Command palette**: Ctrl+K modal with debounced live search across APIs/columns/tables/families, keyboard navigation, inline filter tokens (`fam:`, `sys:`, `dom:`, `status:`, `col:`, `tbl:`, `api:`), prefix-match ranking.

### Tests

47 tests pass across 4 files: tokenizer grammar (30), catalog validator + probes (10), clear-index roundtrip (2), **indexer integration (5)**. The integration tests cover the YAML→SQLite pipeline end-to-end against a 3-spec fixture in `tests/fixtures/small-catalog/` including sentinels, multi-version resources, EEDM-vs-Bus lineage-edge classification, stale-file cleanup, and incremental re-scan.

### Known issues (from end-of-Phase-1 code review)

Ordered by severity. Three HIGH items were fixed this session; the rest are deferred to Phase 2 or later.

- ✅ **Stale-fetch races in profile views** (HIGH, fixed) — `ApiDocsView`, `ColumnProfile`, `TableProfile` now use `AbortController` so rapid navigation cancels older in-flight requests before their responses can overwrite newer state.
- ✅ **Catalog overview links went to raw JSON** (HIGH, fixed) — the top-columns/tables grid on the landing page bypassed the SPA. Now routes through `onSelectColumn`/`onSelectTable`.
- ✅ **`_db` reference order in `/api/index/clear`** (MEDIUM, fixed) — detach the cached handle before closing + deleting, so concurrent requests get a fresh connection.
- ✅ **SSE indexer stream can't be cancelled by client** (MEDIUM, fixed) — `indexCatalog()` now takes an `AbortSignal`; the SSE handler passes `req.signal`; per-file `throwIfAborted()` stops scans within one parse. Status persisted to `meta.last_scan_status` so the dashboard surfaces incomplete scans (`c5d7737`, BACKLOG B-003 / QOL-003).
- ⏭ **Client EventSource treats transient reconnects as fatal** (MEDIUM) — for a 2-minute scan a network hiccup can end the stream prematurely; add a check against `source.readyState === EventSource.CLOSED`.
- ⏭ **Path-traversal `startsWith` check is prefix-based** (MEDIUM, low exploit risk) — `resolved.startsWith(DIST_DIR)` also matches sibling directories like `dist-evil/`. Change to `resolved === DIST_DIR || resolved.startsWith(DIST_DIR + path.sep)`.
- ⏭ **LIKE `_`/`%` over-matches** (MEDIUM, correctness not security) — user queries `SPRIDEN_ID` match columns like `SPRIDENXID` via the `_` wildcard. Fix: escape `_` and `%` in user input with `ESCAPE '\\'` (already used in `/api/columns/prefix/:name`).
- ⏭ **`validateCatalogPath` runs full tree walk per call** (MEDIUM, performance) — `/api/config` runs it on every fetch, and the wizard runs it on every 400 ms-debounced keystroke. Two lighter modes: (a) fast-pass (count `*APIs/` dirs via `scandir`, no YAML count) for debounced validation, (b) cache against `(path, root-dir-mtime)`.
- ✅ **`server.ts` is 1,200+ lines** (MEDIUM, maintainability, fixed) — split into per-route modules under `server/routes/*.ts` (apis / catalog / columns / config / environments / families / indexer / lineage / search / static / status / tables) + `server/routes/index.ts` as the dispatcher. `server.ts` is now ~60 lines (bootstrap + graceful shutdown only).
- ⏭ **Svelte profile views duplicate helpers** (MEDIUM, maintainability) — `TOKEN_RE`, `splitExpression`, `prettyFieldPath`, several CSS classes. Extract to `web/lib/lineage.ts` and a shared stylesheet.
- ⏭ **FTS5 triggers in the schema but never queried** (LOW, dead code) — either wire `/api/search` to FTS5 (better fuzzy ranking) or drop the triggers until we need them. Dead triggers cost ~15% write throughput during re-index.
- ⏭ **Four `acx:…:v1` localStorage keys with no shared migration** (LOW) — centralise in `web/lib/storage.ts` before any v2 schema change.
- ⏭ **Shell `readerMode` loses manual panel toggles** (LOW UX) — if the user Ctrl+Bs while in reader mode, the prior-state snapshot is stale when they exit reader mode. Rare path.
- ⏭ **`Ctrl+.` relies on `e.key`** (LOW) — on international keyboards `.` may require Shift, which the handler's `!e.shiftKey` rejects. Prefer `e.code === "Period"`.
- ⏭ **`/api/catalog/probes` does sequential `stat` awaits** (LOW) — parallelise with `Promise.all` for snappier wizard startup.

### Tests still missing (to add in Phase 2)

The indexer roundtrip is now covered. Also now covered (Phase 2 items 1-4):

- ✅ DPAPI wrapper — `tests/secrets.test.ts` covers round-trip (ASCII + unicode), delete, list, plaintext-not-on-disk, persistence, and tampered-ciphertext rejection.
- ✅ Environment profile store — `tests/environments.test.ts`, 21 tests covering CRUD, active-env persistence, legacy-field stripping on load.
- ✅ Ethos JWT token cache — `tests/ethos-auth.test.ts`, 7 tests (fetch + cache + invalidate + error paths against in-process Bun.serve fixture).
- ✅ Request proxy — `tests/ethos-proxy.test.ts`, 17 tests (happy-path + header strip/merge + response shaping + 401 retry + error mapping + onComplete hook).

Still missing:

- HTTP surface for Phase 1 endpoints: `/api/search` with filter parsing, `/api/apis/:family/:resource` version resolution, `/api/columns/:name` enrichment, `/api/tables/:name` at-a-glance.
- End-to-end Playwright smoke: launch → wizard → index → click column → search → send proxy request.

## Phase 2 — in progress

Goal: real API calls work end-to-end for users whose Ellucian tenant is accessible. Phase 2 is *the* try-APIs crowd.

**Shipped so far (items 1-7):** DPAPI secret storage, environment profile manager, Ethos API key → JWT exchange, request proxy, Try panel, verb-safety modal, and (2026-04-24) the full **Response Panel** — four tabs (Raw / Table / Headers / Timing) in the Shell's bottom slot with algorithmic decomposition of JSON into flat peer tables. State lifted from TryPanel to App.svelte with AbortController for cancel-previous. Proxy extended with `X-Proxy-*` response headers (auth / request / response ms, request / response bytes). 180 tests pass (25 new: shape + highlight + format + compare + proxy timings); typecheck clean; smoke-tested against real Ellucian including the QoL sort/resize/hide/copy affordances and the parent-filter nav on count-link chips.

**Must-have:**

1. ✅ **Environment profile manager** (Settings → Environments, at `/settings/environments`). CRUD UI backed by `%APPDATA%\api-catalog-explorer\environments.json`; API keys stored DPAPI-encrypted in the sibling `secrets.json` under key `env/<id>/api_key`. Fields per profile: name, production flag, API key. Region is workspace-level (stored in `config.json`) — one dropdown at the top of the Environments panel applies to all envs. The base URL and auth URL are derived from region. Top-bar env selector (with a red dot indicator when the active env is production) switches active env in one click; `activeId` persists across launches. Settings accessed via a gear icon in the top bar or by navigating directly to `/settings/environments`.
2. ✅ **Windows DPAPI secret storage** — two-layer split. `server/auth/dpapi.ts` is a thin `bun:ffi` wrapper around `CryptProtectData` / `CryptUnprotectData` from `crypt32.dll` (no I/O). `server/auth/secrets.ts` is a generic key/value store on top, persisting base64 ciphertexts to `%APPDATA%\api-catalog-explorer\secrets.json` via atomic tmp+rename writes. Entirely in-app — no `CredWrite`, nothing visible in `Manage Windows Credentials`. End-to-end tests in `tests/secrets.test.ts` cover round-trip (ASCII + unicode), delete, list, plaintext-not-on-disk, persistence, and tampered-ciphertext rejection.
3. ✅ **Ellucian API key → JWT exchange** (`server/auth/ethos.ts`) — POST the stored API key as `Authorization: Bearer <api_key>` to `${regionBaseUrl}/auth`, receive plaintext JWT, cache in RAM per env for 4 minutes (5-minute server TTL minus 60-second safety margin). `invalidate()` forces refresh on downstream 401. Consumed by the request proxy (item 4) — no HTTP surface of its own. "Test connection" UI deferred.
4. ✅ **Request proxy** (`server/proxy/ethos.ts`) — `/api/ethos/<path>` forwards UI requests to `${regionBaseUrl}/<path>` with the env's cached Bearer JWT attached. Transparent method/body/header passthrough; 401 triggers a one-shot invalidate + retry. Exposes an `onComplete` hook (currently a no-op).
5. ✅ **Try panel UI** (`web/docs/TryPanel.svelte`) — click an endpoint in the docs → form renders. URL bar + tabs (Params / Headers / Body). Schema-driven controls (text / retro dropdown / native date / UUID validator / chips / recursive nested form). EEDM `criteria={...}` flattening via description scraper + picker + Raw JSON toggle. Version switching re-projects drafts with orphan/coercion/undocumented-chip warnings. Body defaults to Raw JSON with Prefill-from-schema; Form mode available with recursive nested rendering. F5 / Ctrl+Enter send; Shift+F5 skips the prod verb-safety modal.
6. ✅ **Response panel UI** (`web/docs/response/ResponsePanel.svelte`) — full-width under the three top panes. **Table** tab algorithmically decomposes JSON into flat peer tables (`shape.ts` — handles wrapper-collapse, pass-through rows, heterogeneous splits, 5-deep nesting, `_parent_id` vs `_parent_idx` synthesis); rail-less when there's one table, tree-rail when multiple; count-link chips navigate + filter by parent; sort / resize / hide-cols / copy-cell QoL affordances on the grid. **Raw** tab offers collapsible JSON tree (default ON), flat text with highlighting, pretty-print + line numbers, binary hex head, head-slice for >1 MB. **Headers** tab has Response / Request sub-tabs with per-tab Copy, click-to-reveal redaction on Authorization / Cookie / Set-Cookie. **Timing** tab renders Auth / Request / Response / Total bars (server-side phases via `X-Proxy-*` headers) + bytes, with human-readable ms-or-seconds formatting. Response state lifted from TryPanel to App.svelte with AbortController for cancel-previous.
7. ✅ **Verb safety modal** — folded into item 5. Prod env + non-GET → confirm dialog with env badge, method + URL, redacted body preview, Send/Cancel. Esc cancels, Enter confirms. `Shift+F5` on the original Send skips the modal for one request.
~~8. Request history~~ — **scrapped 2026-04-27.** Implemented + merged + reverted in one session; the user judged the feature unnecessary against the project's terseness goals. Reflog has the 22-commit branch for ~30 days if reconsidered. The proxy's `onComplete` hook stays in place for any future reconsideration.

**Should-do during Phase 2 while we're in there:**

- ✅ Split `server.ts` into per-route modules — done. Each handler is now testable without booting `Bun.serve`.
- Extract shared helpers from profile views into `web/lib/lineage.ts`.
- ✅ AbortSignal wire-up for the SSE indexer stream — done (`c5d7737`).
- Add HTTP-surface integration tests for the search / profile / API-detail endpoints.

**Nice-to-have (deferrable):**

- UI scaler (see dedicated section below).
- Theme CSS token clean-up so method badges and other semantic colours opt in per theme if they need to.
- `acx:*` localStorage consolidation.

### Accessibility — UI scaler (planned for Settings)

Some users have less-than-20/20 vision and the default type size (11–13 px in many panes) is cramped for them. Before Phase 2, Settings → Appearance should include a **UI scale factor** that multiplies the root font size:

- Options: **100% · 115% · 130% · 150%** (the last one is genuinely big — users who need it will appreciate it).
- Implementation: a single `font-size` value on `:root` drives every `rem` / `em`-based dimension. Almost every spacing and text rule already uses `var(--space-*)` tokens or relative units, so a single root change propagates. Any pixel-perfect CSS that would break at 1.5× needs one audit pass.
- Persists to the same localStorage/theme.json as the palette and CRT effects.
- Browser zoom (Ctrl+`+`) is a fallback but doesn't scale cleanly when mixed with our SVG splitters and the command palette; an explicit in-app scaler is the accessible default.
- Secondary toggle to consider once the base scaler exists: **density (compact / comfortable)** — changes the `--space-*` tokens independently of text size, for users who want bigger text but tight layout (or vice versa).

Captured here so it doesn't get lost; build it when the Settings area lands.

### Manual index controls (added)

- `POST /api/index/clear` — closes the DB, deletes the SQLite backing files, next query recreates an empty schema. Exposed in the UI as a small "Clear index" link on the dashboard and in the wizard's invalid-path notice.
- Stale-file cleanup now runs at the end of every scan (files on the stored index that weren't encountered on this disk walk are removed along with their cascading rows), so switching catalog roots or deleting specs no longer leaves ghost data behind.
- `GET /api/config` auto-prunes `recentPaths` entries that no longer exist on disk, so the wizard never shows stale ghosts.
- Graceful shutdown: the Bun server closes the DB on `SIGINT` / `SIGTERM` / `SIGHUP` / uncaught exceptions so SQLite can checkpoint cleanly and doesn't leave orphan `-shm`/`-wal` files.

