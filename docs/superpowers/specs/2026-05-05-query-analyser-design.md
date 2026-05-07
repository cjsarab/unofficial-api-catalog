# Query Analyser — Design Spec

**Date:** 2026-05-05
**Phase:** 3, Wave 1
**Status:** design approved, ready for implementation plan
**Related:** `PLAN.md` § "Migration workflow" (the original spec — this doc supersedes the "column basket" framing)

## Context

Phase 3's primary deliverable for the PL/SQL-veteran persona is a tool that answers: *"I have this query with N columns — which API calls do I make to get the same data back?"*

The original `PLAN.md` framing called this a **column basket** (persistent dock + SQL paste + set-cover matcher). In design review the noun-named "basket" UI was renamed to a verb-named **Query Analyser** — both because it's clearer and because the persistent-everywhere dock added visual clutter for a workflow that is actually phased (collect columns → analyse → return to browsing). The "follow you everywhere" basket collapses to a single counter chip in the top bar; the workspace itself is a modal.

This spec defines that workspace, the matching algorithm, and the gap-classification machinery the matcher emits alongside the ranked API sets.

## Scope

### In scope (Wave 1)

- **Top-bar chip** (`Q  N`) showing current basket size; click opens modal; `Ctrl+Q` shortcut.
- **Add-to-basket affordance** (`+`) on every column token in `ColumnProfile`, `TableProfile`, `ApiDocsView` lineage expressions, and `ColumnDict` sidebar rows.
- **Query Analyser modal** (~960 px wide, `web/styles/settings-modal.css` pattern from settings):
  - SQL paste textarea + "Extract columns" button.
  - Current basket list with per-row remove + bulk clear.
  - Ranked API-set results.
  - Gap panel (classified — three buckets).
- **Set-cover matcher** with coverage-ratio-aware greedy ranking.
- **Tolerant SQL extractor** for Banner / Colleague identifier conventions.
- **Gap classifier** (3 buckets: `ellucian-gap`, `typo`, `lineage-only`).
- **Persistence**: single current basket in `localStorage` under `acx:basket:v1`.
- **Server endpoints**: `POST /api/query-analyser/analyse`, `POST /api/query-analyser/suggest`.

### Out of scope (deferred to Wave 1.5 / 2)

- **"Copy as code" recipes** (TS / Python / PowerShell stubs) — Wave 1.5.
- **Multiple named baskets / saved baskets** — single-basket model only; users re-paste their SQL if they want to revisit.
- **Lineage graph** — Wave 2.
- **Theme switcher CRT controls + preset layouts** — Wave 3 (polish).
- **Server-side basket persistence** — `localStorage` is sufficient for the single-user-single-device model.
- **Partial-catalog gap classification** ("install family X to find this column") — impossible without an out-of-band Ellucian column-to-family manifest; the app only knows what it has indexed.

## UX

### Top-bar chip

Lives in `web/shell/TopBar.svelte`'s `.right-controls` group, positioned **before** the env selector. Mimics the `.env-selector` and `.gear` button styling (1 px border, mono font, `var(--fg-dim)` default → `var(--fg-bright)` on hover, no radius, no fill).

```svelte
<button class="qa-chip" onclick={openQueryAnalyser} title="Query Analyser (Ctrl+Q)">
  <span class="label">Q</span>
  <span class="count" class:has-items={basketCount > 0}>{basketCount}</span>
</button>
```

- **Empty state**: `Q  0` rendered fully dim. Clickable but visually quiet.
- **Populated state**: `Q  3` with the count in `var(--accent)` (phosphor-on-default-theme). The chip surface stays the same; only the count "lights up" — same activity-cue pattern as the env-selector's `dot.prod` red dot.
- **Click feedback**: brief `0.15s` `scale(1.08)` flash on count-change (so a `+` button click elsewhere produces visible feedback if the user happens to be looking at the chip).
- **Keyboard**: `Ctrl+Q` opens the modal. Also surfaced as a command palette entry: `"Open Query Analyser"`.

### `+` affordances

Every column token across the app gets a small `+` button rendered after the token text. The token + button together form a click target group:

- **Column profile header** (`web/docs/ColumnProfile.svelte`) — next to the column name in the page title row.
- **Table profile column list** (`web/docs/TableProfile.svelte`) — per-row, plus an "Add all columns on this table" bulk button at the section header.
- **Lineage expression tokens** (`web/docs/ApiDocsView.svelte`) — small `+` next to each `splitExpression` token rendering.
- **Column dictionary sidebar rows** (`web/sidebar/ColumnDict.svelte`) — appears on row-hover only (otherwise the sidebar gets visually noisy with 18,350 rows).

Clicking `+` adds the column to the basket and surfaces a 2-second toast at the bottom of the screen: `"Added SPRIDEN_ID to Q (3 columns)"`. Toast styling matches existing `wizardToast` pattern in `App.svelte`. If the column is already in the basket, the click is a no-op and the toast reads `"SPRIDEN_ID already in Q"`.

### Modal layout

Settings-modal pattern (`web/App.svelte` lines 813-836 + `.settings-backdrop` / `.settings-dialog` styles). Click-backdrop or Escape dismisses. `data-theme` inheritance gives free phosphor / amber / dos / beige rendering.

```
┌─ Query Analyser ──────────────────────────────────── × ┐
│                                                        │
│  ┌─ Paste SQL ──────────────────┐ ┌─ Results ────────┐ │
│  │                              │ │                   │ │
│  │  [textarea, ~6 rows]         │ │  Set 1 — covers  │ │
│  │                              │ │   7 of 10 cols   │ │
│  │  [Extract columns]           │ │   /persons (5)   │ │
│  │                              │ │   /addresses (2) │ │
│  └──────────────────────────────┘ │   join: SPRIDEN_ │ │
│                                    │     ID           │ │
│  ┌─ Basket (3) ── [Clear all] ──┐ │                   │ │
│  │  SPRIDEN_ID            [×]   │ │  Gaps (3)        │ │
│  │  SPBPERS_BIRTH_DATE   [×]   │ │   typo (1):       │ │
│  │  SPBPERS_SEX          [×]   │ │     SPRDEN_ID →   │ │
│  │                              │ │       SPRIDEN_ID? │ │
│  │  [+] Add column…             │ │   ellucian (1):   │ │
│  │                              │ │     SPBPERS_FOO   │ │
│  └──────────────────────────────┘ │   lineage (1):    │ │
│                                    │     CSM.START.DT  │ │
│                                    └───────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- Two columns inside the modal (`grid-template-columns: 1fr 1fr`).
- **Left column top**: SQL textarea + "Extract columns" button. Extraction is synchronous (regex), so no spinner.
- **Left column bottom**: basket list — one row per column, monospace, with a `[×]` remove button. Empty state: `"No columns yet. Paste SQL above or click [+] on any column in the app."` Manual add via a small inline input at the bottom of the basket list (typed column name → Enter → added; useful for users who know the name but haven't browsed to it).
- **Right column**: results split into "Sets" (top) and "Gaps" (bottom). Both render only after the basket has ≥ 1 column. While basket is empty, right column shows a placeholder: `"Add columns to see matching APIs."`
- **Header**: "Query Analyser" title + close (×) button. No "Save" button — basket auto-saves to `localStorage` on every mutation.

### Result rendering

**Ranked sets** — each set is a card:

```
┌─ Set 1 ─────────────── covers 7/10 ─┐
│  /persons/v6                         │
│    SPRIDEN_ID, SPRIDEN_LAST_NAME,    │
│    SPRIDEN_FIRST_NAME, SPBPERS_      │
│    BIRTH_DATE, SPBPERS_SEX           │
│                                      │
│  /addresses/v8                       │
│    SPRADDR_STREET_LINE1,             │
│    SPRADDR_CITY                      │
│                                      │
│  Join hint: SPRIDEN_ID returned by   │
│  both — stitch on this column.       │
└──────────────────────────────────────┘
```

- API names link to the existing API detail route (`/apis/:family/:resource`) — clicking opens the docs in a new tab so the modal stays open.
- Up to 3 sets shown by default, with "Show more" if the matcher emits more than 3 viable rankings.
- Coverage badge `7/10` uses `var(--accent)` if = basket size, `var(--fg-bright)` if partial, dim if < 50%.

**Gap panel** — three subsections, only rendered if non-empty:

- **Typos / aliases**: each row shows the user's input with one strike-through, an arrow, and a clickable suggestion (clicking replaces the basket entry with the suggestion).
- **Ellucian gaps**: plain list. No action — informational only.
- **Lineage-only**: plain list with a tooltip showing one of the lineage expressions where it appears (so users can see "we know about this column from `x-lineageReferenceObject` but no API returns it").

## Algorithm

### Set-cover matcher

Classic NP-hard set-cover problem. Greedy approximation: at each step pick the API that covers the most uncovered columns. Greedy is within a `ln(n)` factor of optimal, which is fine for 10-column baskets against ~4,400 candidate APIs.

**Coverage-ratio modification.** Naive greedy can produce junk recommendations when API coverage is partial: it may pick an API contributing one obscure column at the cost of a whole HTTP call. Modified greedy:

1. **Filter candidates**: only consider APIs that contribute ≥ 2 uncovered columns from the basket, OR cover ≥ 30 % of the basket (whichever is more permissive). This drops noise APIs that happen to mention one needed column.
2. **Score** each remaining API as `uncovered_columns_contributed / 1.0` (raw count — coverage ratio is the filter, not the score).
3. **Tie-break** by: same family/source-system as already-picked APIs (fewer hops), then `ga` over `beta`, then alphabetical for stability.
4. **Stop** when no remaining API meets the filter, OR all basket columns are covered. Remaining columns flow into the gap panel.

After greedy converges, run **2-opt-lite**: for each pair (Aᵢ, Aⱼ) in the picked set, check whether replacing both with a single API that covers their union improves the recipe. This catches the case where greedy picked two narrow APIs early before realising one wide API would have done both jobs. O(k² × candidates) where k is the picked-set size — k is typically ≤ 5, so cheap.

**Multiple sets.** Re-run greedy 3 times, biasing each run away from the previous run's picks (penalise reused APIs by halving their score). Surfaces alternate recipes like "Set 1 uses Banner APIs, Set 2 uses EEDM APIs covering the same columns." If runs collapse to identical sets (low API diversity), only de-duplicated sets are surfaced.

### Join hints

After picking a set, scan all chosen APIs' returned-columns lists for shared columns. Any column returned by ≥ 2 APIs in the set becomes a join hint. Display priority: columns with `_ID` / `_GUID` / `_CODE` suffix first (likely keys), others below. Cap at 3 hints per set.

### SQL column extractor

Pure client-side regex (no server round-trip). Tolerant — does not parse SQL grammar; just identifier-extraction.

```ts
// web/lib/sql-extract.ts
const BANNER_RE = /\b([A-Z][A-Z0-9_]{2,})\b/g;       // SPRIDEN_ID, SPBPERS_BIRTH_DATE
const COLLEAGUE_RE = /\b([A-Z]+(?:\.[A-Z][A-Z0-9_]*)+)\b/g;  // FA.YEAR, CSM.START.DATE

export function extractColumns(sql: string): string[] {
  // Strip SQL comments + string literals first to avoid matching inside them.
  const stripped = sql
    .replace(/--[^\n]*/g, "")           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, "")  // block comments
    .replace(/'(?:[^']|'')*'/g, "''");  // string literals (preserve outer quotes for tokenisation)

  const banner = [...stripped.matchAll(BANNER_RE)].map((m) => m[1]);
  const colleague = [...stripped.matchAll(COLLEAGUE_RE)].map((m) => m[1]);

  // Strip alias prefixes: "s.SPRIDEN_ID" was tokenised as ["s", "SPRIDEN_ID"] by Banner regex.
  // Both regexes treat alias prefix as a separate token already, so no extra work — but we
  // do need to deduplicate and filter out SQL keywords.

  const candidates = new Set([...banner, ...colleague]);
  const filtered = [...candidates].filter((tok) => !SQL_KEYWORDS.has(tok));
  return filtered.sort();
}

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON",
  "AND", "OR", "NOT", "NULL", "IS", "AS", "ORDER", "BY", "GROUP", "HAVING",
  "DISTINCT", "UNION", "ALL", "INTO", "INSERT", "UPDATE", "DELETE", "VALUES",
  "CASE", "WHEN", "THEN", "ELSE", "END", "WITH", "AS", "TRUE", "FALSE",
  // ... ~50 entries; full list in web/lib/sql-extract.ts
]);
```

**Limitations (documented for the user-facing extractor):**
- One-letter table aliases (`s.SPRIDEN_ID`) — `s` is dropped by the keyword filter (single-char identifiers excluded by `{2,}` length floor).
- Quoted identifiers (`"My Column"`) — not supported; user re-types those manually.
- Computed expressions (`SUBSTR(SPRIDEN_ID, 1, 3)`) — extracts `SUBSTR` and `SPRIDEN_ID`; `SUBSTR` will land in the Ellucian-gap bucket and the user removes it.

### Gap classifier

Runs server-side after the matcher determines which basket columns are uncovered. For each unmatched column:

```ts
// server/migration/classify-gap.ts
type GapKind =
  | { kind: "typo"; suggestions: string[] }      // fuzzy hits in our column index
  | { kind: "lineage-only"; appearsInApis: string[] }  // in lineage_edges but no api returns it
  | { kind: "ellucian-gap" };                    // unknown to our index entirely

export function classifyGap(column: string, db: Database): GapKind {
  // 1. Exact match in lineage_edges (column appears in lineage but no API returns it).
  const lineage = db.query<{ api_id: string }, [string]>(
    `SELECT DISTINCT api_id FROM columns WHERE column_name = ? AND raw_expression LIKE '%' || ? || '%' LIMIT 5`,
  ).all(column, column);
  if (lineage.length > 0) {
    return { kind: "lineage-only", appearsInApis: lineage.map((r) => r.api_id) };
  }

  // 2. Fuzzy suggestion via Levenshtein-1 prefix match.
  const suggestions = fuzzyColumnHits(column, db);
  if (suggestions.length > 0) {
    return { kind: "typo", suggestions };
  }

  // 3. Otherwise — genuine gap.
  return { kind: "ellucian-gap" };
}

function fuzzyColumnHits(column: string, db: Database): string[] {
  // Pull all columns whose first 3 chars match (cheap prefix filter), then Levenshtein-1 in JS.
  const prefix = column.slice(0, 3);
  const candidates = db.query<{ column_name: string }, [string]>(
    `SELECT DISTINCT column_name FROM columns WHERE column_name LIKE ? || '%' LIMIT 200`,
  ).all(prefix);
  return candidates
    .filter((c) => levenshtein(c.column_name, column) <= 1)
    .map((c) => c.column_name)
    .slice(0, 3);
}
```

**Priority order rationale:**
- `lineage-only` checked first because it's the most informative — it tells the user "Ellucian acknowledges this column exists in the source DB but doesn't return it from any API." Different from "we've never heard of it."
- `typo` checked second because typos are recoverable (one click to accept the suggestion). Cheap to compute (prefix filter + bounded fuzzy scan).
- `ellucian-gap` is the residual.

**Suggestion threshold**: Levenshtein distance ≤ 1, top 3 suggestions max. Tighter than the spec's earlier "≤ 2" because at distance 2 the noise rate is high (e.g. `SPRIDEN_ID` would suggest `SPRIDEN_PIDM`, `SPRIDEN_NTYP`, both real-but-wrong columns).

## Server contracts

### `POST /api/query-analyser/analyse`

Request:

```json
{ "columns": ["SPRIDEN_ID", "SPBPERS_BIRTH_DATE", "SPBPERS_SEX", "SPRDEN_FOO"] }
```

Response:

```json
{
  "sets": [
    {
      "covers": 3,
      "of": 4,
      "apis": [
        {
          "family": "BannerEedmAPIs",
          "resource": "persons",
          "version": "12.4.0",
          "covers": ["SPRIDEN_ID", "SPBPERS_BIRTH_DATE", "SPBPERS_SEX"]
        }
      ],
      "joinHints": []
    }
  ],
  "gaps": [
    {
      "column": "SPRDEN_FOO",
      "classification": { "kind": "typo", "suggestions": ["SPRIDEN_ID"] }
    }
  ]
}
```

- Up to 3 sets returned.
- `apis[].covers` lists the basket columns this API contributes (subset of the basket).
- `joinHints` is a flat array of column names returned by ≥ 2 APIs in the set.
- Empty basket → `{ "sets": [], "gaps": [] }`.
- Validation: column names must match `/^[A-Z][A-Z0-9_.]*$/i` (max 100 chars); request size capped at 200 columns.

### `POST /api/query-analyser/suggest`

Used by the manual-add input in the basket UI for "did you mean" autocomplete as the user types. Lightweight wrapper around the same `fuzzyColumnHits` helper.

Request:

```json
{ "prefix": "SPRID" }
```

Response:

```json
{ "matches": ["SPRIDEN_ID", "SPRIDEN_LAST_NAME", "SPRIDEN_FIRST_NAME", "..."] }
```

- Returns up to 10 matches, ordered by occurrence count (most-referenced columns first).
- Used for typeahead, not for typo classification — typo classification calls `classifyGap` directly.

## Persistence

`localStorage` only. New entry in `STORAGE_KEYS`:

```ts
basket: "acx:basket:v1",
```

Value shape:

```ts
type StoredBasket = {
  columns: string[];        // ordered by add-time (newest first)
  updatedAt: number;        // ms epoch — for future "stale basket" detection
};
```

Reads via `getStored<StoredBasket>(STORAGE_KEYS.basket, { columns: [], updatedAt: 0 })`. Writes are best-effort (existing wrapper swallows quota errors).

**Why not server-side**: matches the single-user-single-device model the rest of the app already assumes (theme, layout, sidebar state all use `localStorage`). A server-side basket would need a `data/baskets/current.json` file + an HTTP endpoint, neither of which adds value over `localStorage` for one user.

## States

| State | What renders |
|---|---|
| Modal closed | Top-bar chip shows `Q  N` (N from `localStorage`); rest of app unaffected. |
| Modal open, empty basket | Left column shows SQL textarea + empty-basket placeholder; right column shows "Add columns to see matching APIs." |
| Modal open, basket populated, analyse in flight | Right column shows skeleton sets (3 dim placeholder cards); spinner in the corner of the panel. |
| Modal open, sets returned, no gaps | Sets render; gap panel hidden. |
| Modal open, sets + gaps | Both sections render; gap panel below sets. |
| Modal open, basket of 1 column with no API hits | One set with `covers 0/1`; gap panel shows the one column with its classification. Coverage badge dim. |
| Server error during analyse | Right column shows error banner: `"Couldn't analyse query — <message>. Try again."` Basket persists; user can retry. |

## Testing

### Unit — pure-TS

- `web/lib/sql-extract.test.ts` (~12 tests)
  - Banner identifiers (`SPRIDEN_ID`, `SPBPERS_BIRTH_DATE`)
  - Colleague identifiers (`FA.YEAR`, `CSM.START.DATE`)
  - Mixed query
  - Aliases stripped (`s.SPRIDEN_ID`)
  - Comments stripped (line + block)
  - String literals stripped
  - Keywords filtered (`FROM`, `WHERE`)
  - Single-char identifiers ignored
  - Quoted identifiers ignored
  - Real-world fixture: a 30-line PL/SQL query from the user's reference set

- `server/migration/setcover.test.ts` (~10 tests)
  - Basket of 1 column, 1 perfect API
  - Basket of 1 column, no APIs (gap)
  - Basket of N columns, 1 API covers all
  - Basket of N columns, 2 APIs split coverage
  - Coverage-ratio filter drops single-column-noise APIs
  - 2-opt-lite catches the "narrow + narrow → wide" case
  - Tie-break prefers same family
  - Tie-break prefers `ga` over `beta`
  - Multiple-set diversity (sets 2 + 3 differ from set 1)
  - Stable ordering (same input → same output)

- `server/migration/classify-gap.test.ts` (~6 tests)
  - Exact lineage-only match
  - Typo with single suggestion
  - Typo with multiple suggestions (capped at 3)
  - Ellucian-gap fallthrough
  - Suggestion threshold respected (distance 2 not surfaced)
  - Priority order (lineage-only beats typo when both could match)

### Integration — `tests/query-analyser.test.ts`

Spin up the test server against `tests/fixtures/small-catalog/` (existing fixture — extended with one Bus spec carrying lineage-only columns, one EEDM spec). Cases:

- `POST /api/query-analyser/analyse` with empty basket → empty response.
- `POST /api/query-analyser/analyse` with 3 columns covered by 2 APIs → expected ranked set + join hint.
- `POST /api/query-analyser/analyse` with 1 typo column → gap.kind === "typo", suggestion included.
- `POST /api/query-analyser/analyse` validation: > 200 columns → 400.
- `POST /api/query-analyser/analyse` validation: malformed column name → 400.
- `POST /api/query-analyser/suggest` with 5-char prefix → ranked matches.

### Component — typecheck only

Per the project's existing testing policy (response-panel plan note), Svelte component tests are not set up. Manual smoke covers the modal end-to-end. Pure logic in `sql-extract.ts`, `setcover.ts`, `classify-gap.ts` is exhaustively unit-tested.

### Manual smoke

1. `npm run dev` against the real catalog.
2. Click `+` on `SPRIDEN_ID` in the column dictionary → toast appears, chip increments to `Q  1`.
3. Open palette → "Open Query Analyser" → modal opens with `SPRIDEN_ID` in basket.
4. Paste a small SQL fragment with 4 known columns → "Extract columns" → basket grows to 5.
5. Verify ranked set + join hint render correctly.
6. Verify a deliberately-typo'd column (`SPRDEN_ID`) shows the typo suggestion + click-to-replace works.
7. Close modal, refresh browser, reopen modal → basket persisted.
8. `Ctrl+Q` opens the modal from any route; Escape closes.

## File manifest

### New

- `docs/superpowers/specs/2026-05-05-query-analyser-design.md` (this file)
- `docs/superpowers/plans/2026-05-05-query-analyser.md` (implementation plan)
- `server/migration/setcover.ts` — pure greedy + 2-opt-lite + multiple-set diversity.
- `server/migration/setcover.test.ts`
- `server/migration/classify-gap.ts` — three-bucket gap classifier + fuzzy helper.
- `server/migration/classify-gap.test.ts`
- `server/routes/query-analyser.ts` — `/api/query-analyser/analyse` + `/api/query-analyser/suggest`.
- `web/lib/sql-extract.ts` — tolerant column-identifier extractor.
- `web/lib/sql-extract.test.ts`
- `web/lib/basket.ts` — small store helper around `STORAGE_KEYS.basket` (add / remove / clear / has).
- `web/query-analyser/QueryAnalyserModal.svelte` — modal shell.
- `web/query-analyser/PasteSqlPanel.svelte` — left-column-top.
- `web/query-analyser/BasketList.svelte` — left-column-bottom.
- `web/query-analyser/ResultSets.svelte` — right-column-top.
- `web/query-analyser/GapPanel.svelte` — right-column-bottom.
- `web/query-analyser/AddToBasketButton.svelte` — small reusable `+` button used across the app.
- `tests/query-analyser.test.ts` — HTTP integration tests.

### Modified

- `web/shell/TopBar.svelte` — add `.qa-chip` button + `openQueryAnalyser` callback prop + `basketCount` prop.
- `web/App.svelte` — add `qaOpen` state, `basketCount` derived from basket store, `openQueryAnalyser` / `closeQueryAnalyser` handlers, `Ctrl+Q` global shortcut, render `<QueryAnalyserModal>` when open.
- `web/shell/CommandPalette.svelte` — add "Open Query Analyser" command.
- `web/lib/storage.ts` — add `basket: "acx:basket:v1"` to `STORAGE_KEYS`.
- `web/docs/ColumnProfile.svelte` — render `<AddToBasketButton column={name} />` in header.
- `web/docs/TableProfile.svelte` — per-row + bulk "Add all" button.
- `web/docs/ApiDocsView.svelte` — `<AddToBasketButton>` next to each lineage token.
- `web/sidebar/ColumnDict.svelte` — hover-only `<AddToBasketButton>` per row.
- `server/routes/index.ts` — register `handleQueryAnalyser` in the dispatcher.

### Schema

No SQLite schema changes. Existing `columns`, `endpoints`, `apis`, `lineage_edges` tables provide everything the matcher + classifier need.

## Estimated size

- New code: ~1,200 LOC including tests.
  - `setcover.ts` + tests: ~250 LOC
  - `classify-gap.ts` + tests: ~150 LOC
  - `sql-extract.ts` + tests: ~150 LOC
  - `query-analyser.ts` route: ~80 LOC
  - 6 new Svelte components: ~500 LOC
  - HTTP integration tests: ~120 LOC
- Modified: ~150 LOC (chip + state plumbing + `+` buttons across 4 existing components).

## Open questions deferred to implementation

- **Toast styling** — there's no shared toast component today (`wizardToast` is inline in `App.svelte`). For Wave 1, render the add-to-basket toast inline in `App.svelte` matching the existing wizard pattern. If we end up needing toasts elsewhere we extract.
- **Recipes ("Copy as code")** — explicitly Wave 1.5; the Set card has room for a `[Copy recipe ▾]` button when added later. Reserve the layout slot but don't render in Wave 1.
- **Lineage graph integration** — Wave 2 may add a "Show lineage" link on each set card that opens the API's lineage view. No layout slot reserved; will be additive.
