# Query Analyser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Query Analyser for Phase 3 Wave 1 — top-bar `Q  N` chip, modal workspace (SQL paste + basket + ranked sets + gap panel), set-cover matcher, gap classifier, tolerant SQL extractor, and `+`-button affordances across the four column-rendering surfaces.

**Architecture:** Three pure-TS units TDD'd against contracts (`setcover.ts`, `classify-gap.ts`, `sql-extract.ts`). One thin route handler (`query-analyser.ts`) composing them. One `localStorage`-backed Svelte store (`basket.ts`). Six new components under `web/query-analyser/` plus one reusable `AddToBasketButton.svelte` dropped into four existing column-rendering surfaces. Modal state owned by `App.svelte`; chip count derived from the basket store; no server-side basket persistence.

**Tech stack:** Node 22.5+, TypeScript, `tsx` (server runner), Vite 5 (web bundler), Svelte 5 (runes: `$state` / `$props` / `$derived` / `{@render}`), Vitest 2 (test runner), `node:sqlite` (Node 22.5+ experimental builtin, accessed through the `Database` wrapper in `server/indexer/sqlite.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-05-query-analyser-design.md`.

**Testing policy:** Svelte component tests are not set up in this repo (per the response-panel plan note). Pure-TS units (`setcover.ts`, `classify-gap.ts`, `sql-extract.ts`) are exhaustively unit-tested. The HTTP layer is integration-tested against the existing `tests/fixtures/small-catalog/`. UI is validated via `npm run typecheck` and a manual smoke at the end of the plan.

**Test layout convention:** `vitest.config.ts` discovers tests at `tests/**/*.test.ts` and `web/**/*.test.ts`. Server-side unit tests live in `tests/` (alongside `tokenizer.test.ts`, `validator.test.ts`, etc.) — **not** co-located with source under `server/`. Web-side unit tests are co-located (`web/lib/sql-extract.test.ts`).

**Naming note:** the spec places the matcher + classifier under `server/migration/` (Phase 3's umbrella name). That directory does not exist yet — Task 1 creates it. The route handler lives under `server/routes/query-analyser.ts` next to its peers; only the algorithmic primitives live under `server/migration/`.

---

## File structure

**Create:**
- `server/migration/setcover.ts` — pure greedy + 2-opt-lite + multiple-set diversity.
- `tests/setcover.test.ts` — server unit tests live in `tests/` per repo convention.
- `server/migration/classify-gap.ts` — three-bucket gap classifier + fuzzy helper.
- `tests/classify-gap.test.ts`
- `server/routes/query-analyser.ts` — `POST /api/query-analyser/analyse` + `POST /api/query-analyser/suggest`.
- `web/lib/sql-extract.ts` — tolerant column-identifier extractor.
- `web/lib/sql-extract.test.ts` — co-located web unit test.
- `web/lib/basket.svelte.ts` — `localStorage`-backed Svelte 5 store (add / remove / clear / has / list). `.svelte.ts` extension because runes (`$state`) only work inside `.svelte` / `.svelte.ts` files.
- `web/query-analyser/QueryAnalyserModal.svelte` — modal shell.
- `web/query-analyser/PasteSqlPanel.svelte` — left-column-top.
- `web/query-analyser/BasketList.svelte` — left-column-bottom.
- `web/query-analyser/ResultSets.svelte` — right-column-top.
- `web/query-analyser/GapPanel.svelte` — right-column-bottom.
- `web/query-analyser/AddToBasketButton.svelte` — small reusable `+` button.
- `tests/query-analyser.test.ts` — HTTP integration tests.

**Modify:**
- `server/routes/index.ts` — register `handleQueryAnalyser` in the dispatcher list.
- `web/lib/storage.ts` — add `basket: "acx:basket:v1"` to `STORAGE_KEYS`.
- `web/shell/TopBar.svelte` — add `.qa-chip` button + `openQueryAnalyser` callback prop + `basketCount` prop.
- `web/shell/CommandPalette.svelte` — add "Open Query Analyser" command.
- `web/App.svelte` — own `qaOpen` state; derive `basketCount` from the basket store; wire `openQueryAnalyser` / `closeQueryAnalyser` handlers; `Ctrl+Q` global shortcut; render `<QueryAnalyserModal>` when open.
- `web/docs/ColumnProfile.svelte` — render `<AddToBasketButton column={name} />` in header.
- `web/docs/TableProfile.svelte` — per-row + bulk "Add all columns on this table".
- `web/docs/ApiDocsView.svelte` — `<AddToBasketButton>` next to each lineage token.
- `web/sidebar/ColumnDict.svelte` — hover-only `<AddToBasketButton>` per row.

**Delete:** none.

---

## Task 1: Set-cover matcher (TDD)

Pure-TS greedy set-cover with the coverage-ratio filter, 2-opt-lite, and multi-set diversity passes from spec § "Algorithm". No DB access — operates on a pre-loaded `ApiCandidate[]` shape.

**Files:**
- Create: `server/migration/setcover.ts`
- Create: `tests/setcover.test.ts`

- [ ] **Step 1: Sketch the contract**

Open `server/migration/setcover.ts` and add:

```ts
export interface ApiCandidate {
  apiId: number;
  family: string;
  resource: string;
  version: string;
  releaseStatus: string | null;
  /** Subset of the basket this API can contribute. Pre-filtered by the caller. */
  contributes: string[];
}

export interface PickedSet {
  covers: number;          // total basket columns covered
  of: number;              // basket size
  apis: Array<{
    apiId: number;
    family: string;
    resource: string;
    version: string;
    releaseStatus: string | null;
    covers: string[];      // basket columns this API contributes (within the set)
  }>;
  joinHints: string[];     // columns returned by ≥ 2 APIs in the set
}

export interface SolveOptions {
  /** Number of distinct sets to surface; spec says 3. */
  maxSets?: number;
  /** Coverage-ratio gate from spec § "Algorithm". */
  minContribution?: number;       // default 2
  minCoverageRatio?: number;      // default 0.30
}

export function solveSetCover(
  basket: string[],
  candidates: ApiCandidate[],
  opts?: SolveOptions,
): PickedSet[];
```

- [ ] **Step 2: Add the test scaffold**

Create `tests/setcover.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { solveSetCover, type ApiCandidate } from "../server/migration/setcover.ts";

const api = (
  apiId: number,
  family: string,
  resource: string,
  contributes: string[],
  releaseStatus: "ga" | "beta" | null = "ga",
): ApiCandidate => ({
  apiId,
  family,
  resource,
  version: "1.0.0",
  releaseStatus,
  contributes,
});

describe("solveSetCover", () => {
  test("basket of 1, 1 perfect API", () => {
    const sets = solveSetCover(["A"], [api(1, "F", "x", ["A"])]);
    expect(sets).toHaveLength(1);
    expect(sets[0].covers).toBe(1);
    expect(sets[0].of).toBe(1);
    expect(sets[0].apis.map((a) => a.apiId)).toEqual([1]);
  });

  test("basket of 1, no APIs → empty sets", () => {
    expect(solveSetCover(["A"], [])).toEqual([]);
  });

  test("basket of 5, 1 API covers all", () => {
    const sets = solveSetCover(["A", "B", "C", "D", "E"], [
      api(1, "F", "x", ["A", "B", "C", "D", "E"]),
    ]);
    expect(sets[0].covers).toBe(5);
    expect(sets[0].apis).toHaveLength(1);
  });

  test("basket of 4, 2 APIs split coverage", () => {
    const sets = solveSetCover(["A", "B", "C", "D"], [
      api(1, "F", "x", ["A", "B"]),
      api(2, "F", "y", ["C", "D"]),
    ]);
    expect(sets[0].covers).toBe(4);
    expect(sets[0].apis.map((a) => a.apiId).sort()).toEqual([1, 2]);
  });

  test("coverage-ratio filter drops single-column-noise APIs", () => {
    // basket of 10 cols. Noise API contributes 1 (10%) — dropped.
    // Useful API contributes 2 (20%) — also dropped (under 30% AND under 2-col floor? Wait — floor is ≥2.)
    // Re-read spec: filter is "≥ 2 cols OR ≥ 30%". 2 cols passes. So adjust this test:
    const basket = Array.from({ length: 10 }, (_, i) => `C${i}`);
    const sets = solveSetCover(basket, [
      api(1, "F", "noise", ["C0"]),                             // 1 col, 10% — dropped
      api(2, "F", "useful", ["C1", "C2", "C3", "C4", "C5"]),    // 5 cols — kept
    ]);
    expect(sets[0].apis.map((a) => a.apiId)).toEqual([2]);
    expect(sets[0].covers).toBe(5);
  });

  test("2-opt-lite collapses two narrow APIs into one wide one", () => {
    // Greedy might pick A1 (2 cols) and A2 (2 cols) before discovering A3 covers
    // exactly that union. 2-opt-lite swaps {A1, A2} → {A3}.
    const basket = ["A", "B", "C", "D"];
    const sets = solveSetCover(basket, [
      api(1, "F", "narrow1", ["A", "B"]),
      api(2, "F", "narrow2", ["C", "D"]),
      api(3, "F", "wide", ["A", "B", "C", "D"]),
    ]);
    expect(sets[0].apis.map((a) => a.apiId)).toEqual([3]);
  });

  test("tie-break prefers same family as already-picked APIs", () => {
    const sets = solveSetCover(["A", "B", "C"], [
      api(1, "Banner", "x", ["A", "B"]),
      api(2, "Banner", "y", ["C"]),
      api(3, "Other", "z", ["C"]),
    ]);
    expect(sets[0].apis.map((a) => a.apiId)).toEqual([1, 2]);
  });

  test("tie-break prefers ga over beta", () => {
    const sets = solveSetCover(["A", "B"], [
      api(1, "F", "x-beta", ["A", "B"], "beta"),
      api(2, "F", "x-ga", ["A", "B"], "ga"),
    ]);
    expect(sets[0].apis[0].apiId).toBe(2);
  });

  test("multiple sets surface diverse alternates", () => {
    const sets = solveSetCover(["A", "B"], [
      api(1, "Banner", "x", ["A", "B"]),
      api(2, "EEDM", "y", ["A", "B"]),
    ], { maxSets: 3 });
    expect(sets).toHaveLength(2);                     // no third candidate
    expect(sets[0].apis[0].apiId).not.toBe(sets[1].apis[0].apiId);
  });

  test("stable ordering (same input → same output)", () => {
    const inputs: ApiCandidate[] = [
      api(1, "F", "x", ["A", "B"]),
      api(2, "F", "y", ["B", "C"]),
      api(3, "F", "z", ["A", "C"]),
    ];
    const a = solveSetCover(["A", "B", "C"], inputs);
    const b = solveSetCover(["A", "B", "C"], [...inputs].reverse());
    expect(a[0].apis.map((x) => x.apiId)).toEqual(b[0].apis.map((x) => x.apiId));
  });

  test("join hints surface keys when ≥2 APIs share a column", () => {
    // The matcher receives `contributes` (basket-only). For join hints we need
    // returned-columns. Extend ApiCandidate? See implementation note.
  });
});
```

**Note on the last test:** join hints need each candidate's *full* returned-column list, not just basket contribution. Add a `returnedColumns: string[]` field to `ApiCandidate` and have the route populate it. Use it inside `solveSetCover` only when computing `joinHints`. Update the test fixture helper accordingly:

```ts
const api = (apiId, family, resource, contributes, releaseStatus = "ga", returnedColumns = contributes) => ({
  apiId, family, resource, version: "1.0.0", releaseStatus, contributes, returnedColumns,
});
```

Then add the join-hint test:

```ts
test("join hints surface keys when ≥2 APIs share a column", () => {
  const sets = solveSetCover(["A", "B", "C", "D"], [
    api(1, "F", "x", ["A", "B"], "ga", ["A", "B", "SPRIDEN_ID"]),
    api(2, "F", "y", ["C", "D"], "ga", ["C", "D", "SPRIDEN_ID"]),
  ]);
  expect(sets[0].joinHints).toContain("SPRIDEN_ID");
});

test("join hints prioritise _ID / _GUID / _CODE suffixes, capped at 3", () => {
  const sets = solveSetCover(["A", "B"], [
    api(1, "F", "x", ["A"], "ga", ["A", "FOO", "BAR", "BAZ_ID", "QUX_GUID", "OTHER"]),
    api(2, "F", "y", ["B"], "ga", ["B", "FOO", "BAR", "BAZ_ID", "QUX_GUID", "OTHER"]),
  ]);
  expect(sets[0].joinHints.slice(0, 3)).toEqual(["BAZ_ID", "QUX_GUID", expect.any(String)]);
});
```

- [ ] **Step 3: Run the tests — expect them all to fail**

Run: `npx vitest run tests/setcover.test.ts`
Expected: every test errors with "Cannot find module" or similar — `setcover.ts` is empty.

- [ ] **Step 4: Implement `solveSetCover` to make the tests pass**

Skeleton:

```ts
const DEFAULTS = { maxSets: 3, minContribution: 2, minCoverageRatio: 0.30 } as const;
const KEY_SUFFIXES = ["_ID", "_GUID", "_CODE"] as const;

export function solveSetCover(
  basket: string[],
  candidates: ApiCandidate[],
  opts: SolveOptions = {},
): PickedSet[] {
  const cfg = { ...DEFAULTS, ...opts };
  if (basket.length === 0) return [];
  if (candidates.length === 0) return [];

  const sets: PickedSet[] = [];
  const penalty = new Map<number, number>();          // apiId → score multiplier (used by diversity passes)

  for (let pass = 0; pass < cfg.maxSets; pass++) {
    const picked = greedyOnce(basket, candidates, cfg, penalty);
    if (picked.apis.length === 0) break;
    if (sets.some((s) => sameApiSet(s, picked))) continue;
    sets.push(picked);
    for (const a of picked.apis) penalty.set(a.apiId, (penalty.get(a.apiId) ?? 1) * 0.5);
  }

  return sets;
}

function greedyOnce(basket, candidates, cfg, penalty): PickedSet { /* ... */ }
function twoOptLite(picked, candidates, basket): PickedSet { /* ... */ }
function joinHintsFor(apis: PickedSet["apis"], candidates: ApiCandidate[]): string[] { /* ... */ }
function sameApiSet(a: PickedSet, b: PickedSet): boolean { /* ordered apiId comparison */ }
```

Key behaviours to implement:
- `greedyOnce`: uncovered = `new Set(basket)`. Each iteration: filter candidates whose `contributes ∩ uncovered` size ≥ `cfg.minContribution` OR ≥ `cfg.minCoverageRatio * basket.length`. Score = `(uncovered ∩ contributes).size * (penalty.get(apiId) ?? 1)`. Tie-break: prefer same family as last picked, then `releaseStatus === "ga"`, then `apiId` ascending. Stop when no candidate qualifies or `uncovered.size === 0`.
- `twoOptLite`: for each pair `(i, j)` in picked, find any candidate whose `contributes` ⊇ `(picked[i].covers ∪ picked[j].covers)`. If found, replace both with that candidate. Repeat until stable (max 5 iterations as a safety cap).
- `joinHintsFor`: collect every column appearing in `≥ 2` of picked APIs' `returnedColumns`. Sort: `_ID` / `_GUID` / `_CODE` suffix first, then alphabetical. Slice 3.

- [ ] **Step 5: Re-run tests until green**

Run: `npx vitest run tests/setcover.test.ts`. Iterate until all pass. If a test reveals a spec ambiguity, prefer the test's interpretation and add a one-line comment in `setcover.ts` explaining.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

---

## Task 2: Gap classifier (TDD)

Three-bucket classifier (`lineage-only` / `typo` / `ellucian-gap`) per spec § "Gap classifier". DB-touching but the dependency is minimal — pass a `Database` handle in for testability.

**Files:**
- Create: `server/migration/classify-gap.ts`
- Create: `tests/classify-gap.test.ts`

- [ ] **Step 1: Sketch the contract**

```ts
import type { Database } from "../indexer/sqlite.ts";   // wrapper around node:sqlite

export type GapKind =
  | { kind: "typo"; suggestions: string[] }
  | { kind: "lineage-only"; appearsInApis: number[] }
  | { kind: "ellucian-gap" };

export function classifyGap(column: string, db: Database): GapKind;
export function fuzzyColumnHits(column: string, db: Database): string[];
```

- [ ] **Step 2: Write tests against an in-memory SQLite fixture**

Create `server/migration/classify-gap.test.ts`. Build a tiny in-memory schema mirroring the columns table:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { classifyGap } from "./classify-gap.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE apis (id INTEGER PRIMARY KEY, family TEXT, resource TEXT);
    CREATE TABLE columns (
      api_id INTEGER, column_name TEXT, kind TEXT,
      raw_expression TEXT, field_path TEXT, table_name TEXT
    );
  `);
  return db;
}

describe("classifyGap", () => {
  test("ellucian-gap fallthrough — column unknown to the index", () => {
    const db = freshDb();
    expect(classifyGap("WHO_KNOWS", db)).toEqual({ kind: "ellucian-gap" });
  });

  test("typo with single suggestion via Levenshtein-1", () => {
    const db = freshDb();
    db.run(`INSERT INTO apis VALUES (1, 'Banner', 'persons')`);
    db.run(`INSERT INTO columns VALUES (1, 'SPRIDEN_ID', 'column', 'SPRIDEN_ID', 'id', 'SPRIDEN')`);
    const out = classifyGap("SPRDEN_ID", db);
    expect(out.kind).toBe("typo");
    if (out.kind === "typo") expect(out.suggestions).toContain("SPRIDEN_ID");
  });

  test("typo suggestions capped at 3", () => {
    const db = freshDb();
    db.run(`INSERT INTO apis VALUES (1, 'Banner', 'x')`);
    // Five candidates all distance-1 from the input.
    for (const c of ["AAAAA", "AAAAB", "AAAAC", "AAAAD", "AAAAE"]) {
      db.run(`INSERT INTO columns VALUES (1, '${c}', 'column', '${c}', 'p', 't')`);
    }
    const out = classifyGap("AAAAX", db);
    if (out.kind !== "typo") throw new Error("expected typo");
    expect(out.suggestions.length).toBeLessThanOrEqual(3);
  });

  test("lineage-only beats ellucian-gap when column appears in raw_expression but no row has it as column_name", () => {
    const db = freshDb();
    db.run(`INSERT INTO apis VALUES (1, 'Banner', 'persons')`);
    // No column row named 'CSM.START.DATE' but it appears inside a raw_expression.
    db.run(`INSERT INTO columns VALUES (1, 'OTHER', 'column', 'COALESCE(CSM.START.DATE, NULL)', 'p', 't')`);
    const out = classifyGap("CSM.START.DATE", db);
    expect(out.kind).toBe("lineage-only");
  });

  test("priority: lineage-only beats typo when both could match", () => {
    const db = freshDb();
    db.run(`INSERT INTO apis VALUES (1, 'F', 'x')`);
    db.run(`INSERT INTO columns VALUES (1, 'SPRIDEN_IDX', 'column', 'SPRIDEN_IDX', 'p', 't')`);
    db.run(`INSERT INTO columns VALUES (1, 'OTHER', 'column', 'ref to SPRIDEN_ID here', 'p', 't')`);
    // SPRIDEN_ID: distance-1 from SPRIDEN_IDX (typo candidate), AND in raw_expression (lineage).
    expect(classifyGap("SPRIDEN_ID", db).kind).toBe("lineage-only");
  });

  test("Levenshtein-2 NOT surfaced as typo (threshold respected)", () => {
    const db = freshDb();
    db.run(`INSERT INTO apis VALUES (1, 'F', 'x')`);
    db.run(`INSERT INTO columns VALUES (1, 'SPRIDEN_PIDM', 'column', 'SPRIDEN_PIDM', 'p', 't')`);
    // distance(SPRIDEN_AAAA, SPRIDEN_PIDM) = 4 — well past threshold.
    expect(classifyGap("SPRIDEN_AAAA", db)).toEqual({ kind: "ellucian-gap" });
  });
});
```

**Important wrinkle:** the spec's `classifyGap` checks `lineage` first via `column_name = ?` AND `raw_expression LIKE '%' || ? || '%'`. That predicate doesn't actually do what the spec describes ("appears in lineage but no API returns it"). Re-read: the intent is "no row has `column_name = X`, but X appears inside *some other* row's raw_expression." The implementation needs to query `WHERE column_name != ? AND raw_expression LIKE '%' || ? || '%'` AND verify that no row has `column_name = ?`. Gather both signals and decide.

Implement accordingly (the test fixture above is written to match this corrected intent).

- [ ] **Step 3: Implement `classifyGap` + `fuzzyColumnHits`**

```ts
export function classifyGap(column: string, db: Database): GapKind {
  // 1. Is the column directly returned by any API?
  const direct = db.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM columns WHERE column_name = ? AND kind = 'column'`,
  ).get(column);
  if (direct && direct.n > 0) {
    // Caller shouldn't pass these — but defensive: a "covered" column isn't a gap.
    return { kind: "ellucian-gap" };  // unreachable in practice; matcher pre-filters
  }

  // 2. Lineage-only: column appears inside raw_expression of some other row.
  const lineage = db.query<{ api_id: number }, [string]>(
    `SELECT DISTINCT api_id FROM columns
     WHERE raw_expression LIKE '%' || ? || '%' AND column_name != ?
     LIMIT 5`,
  ).all(column, column);
  if (lineage.length > 0) {
    return { kind: "lineage-only", appearsInApis: lineage.map((r) => r.api_id) };
  }

  // 3. Typo: Levenshtein-1 against same-prefix columns.
  const suggestions = fuzzyColumnHits(column, db);
  if (suggestions.length > 0) return { kind: "typo", suggestions };

  return { kind: "ellucian-gap" };
}

export function fuzzyColumnHits(column: string, db: Database): string[] {
  const prefix = column.slice(0, 3);
  if (prefix.length < 3) return [];
  const candidates = db.query<{ column_name: string }, [string]>(
    `SELECT DISTINCT column_name FROM columns
     WHERE column_name LIKE ? || '%' AND kind = 'column'
     LIMIT 200`,
  ).all(prefix);
  return candidates
    .map((c) => c.column_name)
    .filter((name) => name !== column && levenshtein(name, column) <= 1)
    .slice(0, 3);
}

function levenshtein(a: string, b: string): number {
  // Standard DP implementation. ~30 LOC. Bail with -Infinity-style early exit
  // if abs(len(a) - len(b)) > 1 since we only care about distance ≤ 1.
  if (Math.abs(a.length - b.length) > 1) return 99;
  // ...
}
```

- [ ] **Step 4: Run tests until green**

`./bun.exe test server/migration/classify-gap.test.ts`

- [ ] **Step 5: Typecheck**

`./bun.exe run typecheck`

---

## Task 3: HTTP route + dispatcher wiring

The `query-analyser.ts` route handler composes Tasks 1 + 2: takes a basket, queries the DB for candidate APIs, runs `solveSetCover`, classifies any uncovered columns, returns the spec's response shape.

**Files:**
- Create: `server/routes/query-analyser.ts`
- Modify: `server/routes/index.ts`

- [ ] **Step 1: Implement the route handler**

`server/routes/query-analyser.ts`:

```ts
import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";
import { errorResponse } from "../lib/http.ts";
import { solveSetCover, type ApiCandidate } from "../migration/setcover.ts";
import { classifyGap, fuzzyColumnHits } from "../migration/classify-gap.ts";

const COLUMN_RE = /^[A-Z][A-Z0-9_.]*$/i;
const MAX_BASKET = 200;
const MAX_COLUMN_LEN = 100;

export const handleQueryAnalyser: RouteHandler = async (req, url) => {
  if (url.pathname === "/api/query-analyser/analyse" && req.method === "POST") {
    return analyse(req);
  }
  if (url.pathname === "/api/query-analyser/suggest" && req.method === "POST") {
    return suggest(req);
  }
  return undefined;
};

async function analyse(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const columns = body?.columns;
  if (!Array.isArray(columns)) return errorResponse("columns must be an array", 400);
  if (columns.length > MAX_BASKET) return errorResponse(`basket too large (max ${MAX_BASKET})`, 400);
  for (const c of columns) {
    if (typeof c !== "string" || c.length === 0 || c.length > MAX_COLUMN_LEN || !COLUMN_RE.test(c)) {
      return errorResponse(`malformed column name: ${JSON.stringify(c)}`, 400);
    }
  }
  if (columns.length === 0) return Response.json({ sets: [], gaps: [] });

  const handle = db();
  const candidates = loadCandidates(handle, columns);
  const sets = solveSetCover(columns, candidates);
  const covered = new Set<string>();
  for (const s of sets) for (const a of s.apis) for (const c of a.covers) covered.add(c);
  const gaps = columns
    .filter((c) => !covered.has(c))
    .map((c) => ({ column: c, classification: classifyGap(c, handle) }));

  // Hydrate `apis[].covers` is already done by solveSetCover. Add `releaseStatus`
  // is also already there. Map family/resource/version through unchanged.
  return Response.json({ sets, gaps });
}

async function suggest(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const prefix = body?.prefix;
  if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > MAX_COLUMN_LEN) {
    return errorResponse("prefix required (1-100 chars)", 400);
  }
  const handle = db();
  // Top-10 by occurrence count, prefix-matching.
  const rows = handle.query<{ column_name: string; n: number }, [string]>(
    `SELECT column_name, count(*) AS n FROM columns
     WHERE kind = 'column' AND upper(column_name) LIKE upper(?) || '%'
     GROUP BY column_name ORDER BY n DESC, column_name LIMIT 10`,
  ).all(prefix);
  return Response.json({ matches: rows.map((r) => r.column_name) });
}

async function readJson(req: Request): Promise<any | Response> {
  try { return await req.json(); }
  catch { return errorResponse("invalid JSON body", 400); }
}

function loadCandidates(handle: ReturnType<typeof db>, basket: string[]): ApiCandidate[] {
  // Step 1: APIs that contribute at least one basket column.
  const placeholders = basket.map(() => "?").join(",");
  const rows = handle.query<
    { api_id: number; family: string; resource: string; version: string;
      release_status: string | null; column_name: string },
    string[]
  >(
    `SELECT DISTINCT a.id AS api_id, a.family, a.resource, a.version, a.release_status,
            c.column_name
     FROM columns c JOIN apis a ON a.id = c.api_id
     WHERE c.kind = 'column' AND c.column_name IN (${placeholders})`,
  ).all(...basket);

  // Group by api_id → contributes[].
  const byApi = new Map<number, ApiCandidate>();
  for (const r of rows) {
    let cand = byApi.get(r.api_id);
    if (!cand) {
      cand = {
        apiId: r.api_id, family: r.family, resource: r.resource, version: r.version,
        releaseStatus: r.release_status, contributes: [], returnedColumns: [],
      };
      byApi.set(r.api_id, cand);
    }
    cand.contributes.push(r.column_name);
  }
  if (byApi.size === 0) return [];

  // Step 2: load full returnedColumns for join-hint computation. One query
  // limited to the candidate api_ids.
  const apiIds = [...byApi.keys()];
  const apiPlaceholders = apiIds.map(() => "?").join(",");
  const allCols = handle.query<{ api_id: number; column_name: string }, number[]>(
    `SELECT DISTINCT api_id, column_name FROM columns
     WHERE kind = 'column' AND api_id IN (${apiPlaceholders})`,
  ).all(...apiIds);
  for (const r of allCols) byApi.get(r.api_id)!.returnedColumns.push(r.column_name);

  return [...byApi.values()];
}
```

- [ ] **Step 2: Register the handler in the dispatcher**

Edit `server/routes/index.ts` — add the import + insert into `apiHandlers` between `handleColumns` and `handleEndpoint` (logical grouping with the other column-y routes):

```ts
import { handleQueryAnalyser } from "./query-analyser.ts";
// ...
const apiHandlers: RouteHandler[] = [
  handleStatus,
  // ...
  handleColumns,
  handleQueryAnalyser,
  handleEndpoint,
  // ...
];
```

- [ ] **Step 3: Typecheck**

`./bun.exe run typecheck`

---

## Task 4: HTTP integration tests

Spin up the test server against the existing small-catalog fixture and exercise both endpoints.

**Files:**
- Create: `tests/query-analyser.test.ts`

- [ ] **Step 1: Skim an existing integration test for the harness pattern**

Open `tests/integration.test.ts` and copy the test-server bootstrap idiom (the `beforeAll` / `afterAll` that starts a Bun server, picks an ephemeral port, and exposes a `request(path, init?)` helper). Re-use it verbatim — do not invent a new harness.

- [ ] **Step 2: Write the test cases**

Create `tests/query-analyser.test.ts` with the spec § "Testing → Integration" cases:

```ts
import { describe, expect, test } from "bun:test";
// ... import the harness from integration.test.ts pattern, OR factor into tests/_server.ts

describe("POST /api/query-analyser/analyse", () => {
  test("empty basket → empty response", async () => {
    const r = await request("/api/query-analyser/analyse", {
      method: "POST", body: JSON.stringify({ columns: [] }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sets: [], gaps: [] });
  });

  test("3-column basket against fixture → ranked set with join hint", async () => {
    // Pick columns known to be in the fixture's persons + addresses APIs.
    // (Inspect tests/fixtures/small-catalog/ to choose accurate names.)
    const r = await request("/api/query-analyser/analyse", {
      method: "POST",
      body: JSON.stringify({ columns: ["SPRIDEN_ID", "SPRIDEN_LAST_NAME", "SPRADDR_CITY"] }),
    });
    const body = await r.json();
    expect(body.sets.length).toBeGreaterThan(0);
    expect(body.sets[0].covers).toBe(3);
    // SPRIDEN_ID likely returned by both persons and addresses → join hint.
    expect(body.sets[0].joinHints).toContain("SPRIDEN_ID");
  });

  test("typo column → gap.kind === 'typo' with suggestion", async () => {
    const r = await request("/api/query-analyser/analyse", {
      method: "POST", body: JSON.stringify({ columns: ["SPRDEN_ID"] }),  // missing 'I'
    });
    const body = await r.json();
    expect(body.gaps[0].classification.kind).toBe("typo");
    expect(body.gaps[0].classification.suggestions).toContain("SPRIDEN_ID");
  });

  test("validation: > 200 columns → 400", async () => {
    const cols = Array.from({ length: 201 }, (_, i) => `COL_${i}`);
    const r = await request("/api/query-analyser/analyse", {
      method: "POST", body: JSON.stringify({ columns: cols }),
    });
    expect(r.status).toBe(400);
  });

  test("validation: malformed column name → 400", async () => {
    const r = await request("/api/query-analyser/analyse", {
      method: "POST", body: JSON.stringify({ columns: ["DROP TABLE x;--"] }),
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/query-analyser/suggest", () => {
  test("5-char prefix → ranked matches", async () => {
    const r = await request("/api/query-analyser/suggest", {
      method: "POST", body: JSON.stringify({ prefix: "SPRID" }),
    });
    const body = await r.json();
    expect(body.matches.length).toBeGreaterThan(0);
    expect(body.matches[0]).toMatch(/^SPRID/i);
  });
});
```

**Note:** if the fixture under `tests/fixtures/small-catalog/` doesn't carry SPRIDEN columns, either (a) extend the fixture with one Bus + one EEDM spec containing them per spec § "Testing → Integration", or (b) substitute fixture-accurate column names. Prefer (b) — extending fixtures is its own scope.

- [ ] **Step 3: Run the tests**

`./bun.exe test tests/query-analyser.test.ts`. Iterate until green.

---

## Task 5: Client SQL extractor (TDD)

Pure-TS regex-based identifier extractor, matching spec § "SQL column extractor" exactly.

**Files:**
- Create: `web/lib/sql-extract.ts`
- Create: `web/lib/sql-extract.test.ts`

- [ ] **Step 1: Write the tests first**

`web/lib/sql-extract.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractColumns } from "./sql-extract.ts";

describe("extractColumns", () => {
  test("Banner identifiers", () => {
    const out = extractColumns("SELECT SPRIDEN_ID, SPBPERS_BIRTH_DATE FROM SPRIDEN");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).toContain("SPBPERS_BIRTH_DATE");
  });

  test("Colleague identifiers", () => {
    const out = extractColumns("SELECT FA.YEAR, CSM.START.DATE FROM FA");
    expect(out).toContain("FA.YEAR");
    expect(out).toContain("CSM.START.DATE");
  });

  test("aliases stripped (s.SPRIDEN_ID)", () => {
    const out = extractColumns("SELECT s.SPRIDEN_ID FROM SPRIDEN s");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).not.toContain("s");
  });

  test("line comments stripped", () => {
    const out = extractColumns("SELECT SPRIDEN_ID -- and SPBPERS_BIRTH_DATE\nFROM SPRIDEN");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).not.toContain("SPBPERS_BIRTH_DATE");
  });

  test("block comments stripped", () => {
    const out = extractColumns("SELECT SPRIDEN_ID /* SPBPERS_BIRTH_DATE */ FROM SPRIDEN");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).not.toContain("SPBPERS_BIRTH_DATE");
  });

  test("string literals stripped", () => {
    const out = extractColumns("SELECT SPRIDEN_ID FROM SPRIDEN WHERE name = 'SPBPERS_BIRTH_DATE'");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).not.toContain("SPBPERS_BIRTH_DATE");
  });

  test("SQL keywords filtered", () => {
    const out = extractColumns("SELECT FROM WHERE JOIN AS SPRIDEN_ID FROM SPRIDEN");
    expect(out).toEqual(["SPRIDEN"].concat(["SPRIDEN_ID"]).sort());
    // Or assert no keyword leaks in:
    for (const kw of ["SELECT", "FROM", "WHERE", "JOIN", "AS"]) {
      expect(out).not.toContain(kw);
    }
  });

  test("single-char identifiers ignored", () => {
    const out = extractColumns("SELECT a FROM x");
    expect(out).not.toContain("a");
    expect(out).not.toContain("x");
  });

  test("quoted identifiers ignored (limitation documented)", () => {
    const out = extractColumns(`SELECT "My Column" FROM SPRIDEN`);
    expect(out).not.toContain("My Column");
  });

  test("computed expressions extract only the column inside", () => {
    const out = extractColumns("SELECT SUBSTR(SPRIDEN_ID, 1, 3) FROM SPRIDEN");
    expect(out).toContain("SPRIDEN_ID");
    expect(out).toContain("SUBSTR");                  // user removes manually per spec note
  });

  test("dedupes repeated columns", () => {
    const out = extractColumns("SELECT SPRIDEN_ID, SPRIDEN_ID FROM SPRIDEN");
    expect(out.filter((c) => c === "SPRIDEN_ID")).toHaveLength(1);
  });

  test("returns sorted output for stability", () => {
    const out = extractColumns("SELECT B_COL, A_COL FROM T");
    expect(out).toEqual([...out].sort());
  });

  test("real-world fixture (30-line PL/SQL)", () => {
    // Inline a realistic snippet — 30 lines mixing joins, comments, computed cols.
    // Validates the pipeline end-to-end against something representative.
    const sql = `
      SELECT s.SPRIDEN_ID, s.SPRIDEN_LAST_NAME, s.SPRIDEN_FIRST_NAME,
             p.SPBPERS_BIRTH_DATE, p.SPBPERS_SEX,
             a.SPRADDR_STREET_LINE1, a.SPRADDR_CITY
      -- everyone in the fall 2025 cohort
      FROM SPRIDEN s
      JOIN SPBPERS p ON p.SPBPERS_PIDM = s.SPRIDEN_PIDM
      LEFT JOIN SPRADDR a ON a.SPRADDR_PIDM = s.SPRIDEN_PIDM
      WHERE s.SPRIDEN_CHANGE_IND IS NULL
        AND p.SPBPERS_DEAD_IND = 'N'
    `;
    const out = extractColumns(sql);
    expect(out).toContain("SPRIDEN_ID");
    expect(out).toContain("SPBPERS_BIRTH_DATE");
    expect(out).toContain("SPRADDR_CITY");
    expect(out).not.toContain("SELECT");
  });
});
```

- [ ] **Step 2: Implement to spec § "SQL column extractor"**

Use the regex pair and keyword set from the spec verbatim. Add a complete-enough `SQL_KEYWORDS` set (~60 entries) covering the common Oracle / ANSI keywords likely to appear in Banner / Colleague queries.

- [ ] **Step 3: Run tests until green**

`./bun.exe test web/lib/sql-extract.test.ts`

---

## Task 6: Basket store + STORAGE_KEYS update

Tiny Svelte 5 store wrapping `localStorage`. Single source of truth for the basket; the chip count and modal both read from it.

**Files:**
- Modify: `web/lib/storage.ts`
- Create: `web/lib/basket.ts`

- [ ] **Step 1: Add the storage key**

In `web/lib/storage.ts`, append to `STORAGE_KEYS`:

```ts
export const STORAGE_KEYS = {
  theme: "acx:theme:v1",
  layout: "acx:layout:v1",
  sidebar: "acx:sidebar:v1",
  familyExpanded: "acx:family-expanded:v1",
  basket: "acx:basket:v1",
} as const;
```

- [ ] **Step 2: Implement the basket store**

Create `web/lib/basket.ts`:

```ts
import { getStored, setStored, STORAGE_KEYS } from "./storage.ts";

export interface StoredBasket {
  columns: string[];        // newest-first per spec
  updatedAt: number;        // ms epoch
}

const initial: StoredBasket = getStored<StoredBasket>(STORAGE_KEYS.basket, {
  columns: [], updatedAt: 0,
});

// Svelte 5 rune-based store. Exposed as a function to defer $state until a
// component imports it (svelte runes can only be called inside .svelte / .svelte.ts
// — we name this file basket.svelte.ts to opt into runes mode).
let state = $state<StoredBasket>(initial);

export function basket() { return state; }
export function basketCount() { return state.columns.length; }
export function basketHas(column: string): boolean { return state.columns.includes(column); }

export function basketAdd(column: string): { added: boolean; total: number } {
  if (state.columns.includes(column)) return { added: false, total: state.columns.length };
  state = { columns: [column, ...state.columns], updatedAt: Date.now() };
  setStored(STORAGE_KEYS.basket, state);
  return { added: true, total: state.columns.length };
}

export function basketRemove(column: string): void {
  if (!state.columns.includes(column)) return;
  state = { columns: state.columns.filter((c) => c !== column), updatedAt: Date.now() };
  setStored(STORAGE_KEYS.basket, state);
}

export function basketClear(): void {
  state = { columns: [], updatedAt: Date.now() };
  setStored(STORAGE_KEYS.basket, state);
}
```

**Note on file name:** Svelte 5 runes (`$state`, `$derived`) only work inside `.svelte` and `.svelte.ts` files. Name this file `basket.svelte.ts` so runes are valid. Update the spec's file manifest mentally — this is a small, mechanical correction.

- [ ] **Step 3: Typecheck**

`./bun.exe run typecheck`

---

## Task 7: AddToBasketButton + 4 drop-in sites

One reusable component, four placements. Each placement is a 1-2 line edit in the existing component.

**Files:**
- Create: `web/query-analyser/AddToBasketButton.svelte`
- Modify: `web/docs/ColumnProfile.svelte`
- Modify: `web/docs/TableProfile.svelte`
- Modify: `web/docs/ApiDocsView.svelte`
- Modify: `web/sidebar/ColumnDict.svelte`

- [ ] **Step 1: Build the component**

`web/query-analyser/AddToBasketButton.svelte`:

```svelte
<script lang="ts">
  import { basketAdd, basketHas } from "../lib/basket.svelte.ts";

  interface Props {
    column: string;
    /** When true, only render on hover of an outer container. The container is
     *  responsible for the `:hover .add-to-basket { opacity: 1 }` rule. */
    hoverOnly?: boolean;
    onadded?: (info: { column: string; total: number; alreadyPresent: boolean }) => void;
  }
  let { column, hoverOnly = false, onadded }: Props = $props();

  function click(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const result = basketAdd(column);
    onadded?.({ column, total: result.total, alreadyPresent: !result.added });
  }
</script>

<button
  type="button"
  class="add-to-basket"
  class:hover-only={hoverOnly}
  class:in-basket={basketHas(column)}
  title={basketHas(column) ? `${column} is already in Q` : `Add ${column} to Q`}
  onclick={click}
>+</button>

<style>
  .add-to-basket {
    appearance: none;
    background: transparent;
    border: 1px solid var(--fg-dim);
    color: var(--fg-dim);
    font-family: inherit;
    font-size: var(--fs-xs);
    padding: 0 var(--sp-1);
    margin-left: var(--sp-1);
    cursor: pointer;
    line-height: 1;
  }
  .add-to-basket:hover {
    color: var(--fg-bright);
    border-color: var(--fg-bright);
  }
  .add-to-basket.in-basket {
    color: var(--accent);
    border-color: var(--accent);
  }
  .add-to-basket.hover-only { opacity: 0; }
  /* Container :hover .add-to-basket.hover-only { opacity: 1 } lives in the consumer. */
</style>
```

**Note:** the toast surface (`"Added SPRIDEN_ID to Q (3 columns)"`) is rendered by `App.svelte`, not by this button. The `onadded` callback bubbles up the result so `App.svelte` can show the toast. See Task 8.

- [ ] **Step 2: Drop into ColumnProfile.svelte**

Open `web/docs/ColumnProfile.svelte`. Find the page-title row that renders the column name. Add `<AddToBasketButton column={name} {onadded} />` next to it. Add the `onadded` prop on the `Props` interface, passing through from parent:

```svelte
<script lang="ts">
  import AddToBasketButton from "../query-analyser/AddToBasketButton.svelte";
  // ...
  interface Props {
    // ...existing props...
    onAddToBasket?: (info: { column: string; total: number; alreadyPresent: boolean }) => void;
  }
  let { /* ... */, onAddToBasket }: Props = $props();
</script>
<!-- ... -->
<h1 class="column-name">
  {name}
  <AddToBasketButton column={name} onadded={onAddToBasket} />
</h1>
```

The parent (probably `App.svelte` or a router-shaped wrapper) passes `onAddToBasket` down to surface the toast.

- [ ] **Step 3: Drop into TableProfile.svelte (per-row + bulk add-all)**

Per-column-row: identical to Step 2 but inside the row template.

Bulk: at the section header, add an "Add all columns on this table" button:

```svelte
<button
  type="button"
  class="add-all"
  onclick={() => {
    let added = 0;
    for (const c of columns) if (basketAdd(c.column_name).added) added++;
    onAddToBasket?.({ column: `${added} columns`, total: basketCount(), alreadyPresent: added === 0 });
  }}
>Add all to Q</button>
```

(The toast string "Added 5 columns to Q (8 total)" is the App's job to format; pass enough info to do it.)

- [ ] **Step 4: Drop into ApiDocsView.svelte (lineage tokens)**

Find where `splitExpression` tokens render (column-name spans inside lineage). Wrap each token-that-is-a-column with `<AddToBasketButton column={token.text} hoverOnly {onadded} />`. The lineage tokens may be many per page — `hoverOnly` keeps them quiet. Add a CSS rule on the parent `.lineage-token` row:

```css
.lineage-row:hover .add-to-basket.hover-only { opacity: 1; }
```

- [ ] **Step 5: Drop into ColumnDict.svelte (sidebar — hover only)**

Per spec: 18,350 rows, so opacity-0 by default, opacity-1 on row hover. Drop one `<AddToBasketButton column={row.column_name} hoverOnly {onadded} />` per row. Add the row-hover rule to the sidebar's CSS file.

- [ ] **Step 6: Typecheck**

`./bun.exe run typecheck`

---

## Task 8: TopBar chip + App.svelte wiring + Ctrl+Q + palette

The chip lives in TopBar; App.svelte owns the modal-open state, the Ctrl+Q shortcut, and the toast.

**Files:**
- Modify: `web/shell/TopBar.svelte`
- Modify: `web/App.svelte`
- Modify: `web/shell/CommandPalette.svelte`

- [ ] **Step 1: Add the chip to TopBar.svelte**

Find the `.right-controls` group. Insert **before** the env selector:

```svelte
<button class="qa-chip" onclick={openQueryAnalyser} title="Query Analyser (Ctrl+Q)">
  <span class="label">Q</span>
  <span class="count" class:has-items={basketCount > 0}>{basketCount}</span>
</button>
```

Add the props:

```ts
interface Props {
  // ...existing props...
  basketCount: number;
  openQueryAnalyser: () => void;
}
```

CSS — mirror `.env-selector` (1 px border, mono, `var(--fg-dim)` default, `var(--fg-bright)` on hover):

```css
.qa-chip {
  appearance: none;
  background: transparent;
  border: 1px solid var(--fg-dim);
  color: var(--fg-dim);
  font-family: inherit;
  font-size: var(--fs-sm);
  padding: var(--sp-1) var(--sp-2);
  cursor: pointer;
  display: inline-flex; gap: var(--sp-2);
}
.qa-chip:hover { color: var(--fg-bright); border-color: var(--fg-bright); }
.qa-chip .count.has-items { color: var(--accent); }

@keyframes qa-pop { 0% { transform: scale(1); } 50% { transform: scale(1.08); } 100% { transform: scale(1); } }
.qa-chip .count { animation: qa-pop 0.15s ease-out; }
```

**Note on the pop animation:** keying the animation off `count` change requires a re-render trigger. Easiest: `{#key basketCount}<span class="count">...</span>{/key}` so Svelte unmounts/remounts on change.

- [ ] **Step 2: Wire state in App.svelte**

```svelte
<script lang="ts">
  import { basket, basketCount as basketCountFn } from "./lib/basket.svelte.ts";
  import QueryAnalyserModal from "./query-analyser/QueryAnalyserModal.svelte";

  let qaOpen = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;

  // The store is reactive via $state; reading basketCountFn() inside a derived
  // re-runs when the store mutates.
  const basketCount = $derived(basketCountFn());

  function openQueryAnalyser() { qaOpen = true; }
  function closeQueryAnalyser() { qaOpen = false; }

  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = null; }, 2000);
  }

  function handleAddToBasket(info: { column: string; total: number; alreadyPresent: boolean }) {
    if (info.alreadyPresent) showToast(`${info.column} already in Q`);
    else showToast(`Added ${info.column} to Q (${info.total} columns)`);
  }

  // Ctrl+Q global shortcut. Existing keydown handler in App.svelte already
  // owns Ctrl+K for the palette — extend it.
  function onKeydown(e: KeyboardEvent) {
    // ...existing handlers...
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "q") {
      e.preventDefault();
      qaOpen = !qaOpen;
    }
  }
</script>

<TopBar {basketCount} {openQueryAnalyser} ...existing props />

<!-- ...existing layout... -->

{#if qaOpen}
  <QueryAnalyserModal onclose={closeQueryAnalyser} onAddToBasket={handleAddToBasket} />
{/if}

{#if toast}
  <div class="qa-toast" role="status">{toast}</div>
{/if}

<style>
  .qa-toast {
    position: fixed; bottom: var(--sp-4); left: 50%; transform: translateX(-50%);
    background: var(--bg-elevated); color: var(--fg-bright);
    border: 1px solid var(--fg-dim); padding: var(--sp-2) var(--sp-3);
    font-family: var(--font-mono); font-size: var(--fs-sm);
  }
</style>
```

Plumb `onAddToBasket={handleAddToBasket}` down through the routing wrapper into ColumnProfile / TableProfile / ApiDocsView / ColumnDict (the four sites from Task 7).

- [ ] **Step 3: Add palette command**

In `web/shell/CommandPalette.svelte` find the existing command list. Add:

```ts
{ id: "open-query-analyser", label: "Open Query Analyser", run: () => onOpenQueryAnalyser() },
```

Thread an `onOpenQueryAnalyser` prop through the same way Ctrl+K commands are passed down today.

- [ ] **Step 4: Typecheck + check the dev server reflects the chip**

`./bun.exe run typecheck`. With `npm run dev` running, hard-refresh the browser. Expected: chip appears in the top bar showing `Q  0` dim. Clicking does nothing visible yet (modal is from Task 9).

---

## Task 9: Modal + sub-components

The modal shell + four panels. Each panel is small (~80-150 LOC). Keep state local where possible; the basket is global via the store.

**Files:**
- Create: `web/query-analyser/QueryAnalyserModal.svelte`
- Create: `web/query-analyser/PasteSqlPanel.svelte`
- Create: `web/query-analyser/BasketList.svelte`
- Create: `web/query-analyser/ResultSets.svelte`
- Create: `web/query-analyser/GapPanel.svelte`

- [ ] **Step 1: Modal shell**

`QueryAnalyserModal.svelte` — copy the settings-modal pattern from `web/App.svelte` lines around `.settings-backdrop` / `.settings-dialog` (or wherever settings lives now). Backdrop click + Escape close. Title row + close button. Two-column grid inside.

```svelte
<script lang="ts">
  import { basket, basketRemove, basketClear } from "../lib/basket.svelte.ts";
  import PasteSqlPanel from "./PasteSqlPanel.svelte";
  import BasketList from "./BasketList.svelte";
  import ResultSets from "./ResultSets.svelte";
  import GapPanel from "./GapPanel.svelte";

  interface Props {
    onclose: () => void;
    onAddToBasket: (info: { column: string; total: number; alreadyPresent: boolean }) => void;
  }
  let { onclose, onAddToBasket }: Props = $props();

  let analysis = $state<null | { sets: any[]; gaps: any[] }>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const cols = $derived(basket().columns);

  async function refresh() {
    if (cols.length === 0) { analysis = null; return; }
    loading = true; error = null;
    try {
      const r = await fetch("/api/query-analyser/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ columns: cols }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      analysis = await r.json();
    } catch (e: any) {
      error = e.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  // Re-analyse whenever the basket changes. Debounce to coalesce rapid changes
  // (e.g. extracting 8 columns from one paste fires 8 mutations in a tight loop).
  let debounce: number | null = null;
  $effect(() => {
    void cols;     // subscribe to cols
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(refresh, 150);
  });

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="qa-backdrop" role="dialog" aria-modal="true" aria-label="Query Analyser" onclick={onBackdrop}>
  <div class="qa-dialog">
    <div class="qa-header">
      <h2>Query Analyser</h2>
      <button type="button" class="qa-close" onclick={onclose} title="Close (Esc)">×</button>
    </div>

    <div class="qa-body">
      <div class="qa-left">
        <PasteSqlPanel {onAddToBasket} />
        <BasketList columns={cols} onremove={basketRemove} onclear={basketClear} {onAddToBasket} />
      </div>
      <div class="qa-right">
        {#if cols.length === 0}
          <div class="placeholder">Add columns to see matching APIs.</div>
        {:else if error}
          <div class="error">Couldn't analyse query — {error}. <button onclick={refresh}>Retry</button></div>
        {:else if loading || !analysis}
          <div class="skeleton">…analysing…</div>
        {:else}
          <ResultSets sets={analysis.sets} />
          <GapPanel gaps={analysis.gaps} onAcceptSuggestion={(orig, sugg) => {
            basketRemove(orig);
            onAddToBasket({ column: sugg, total: 0, alreadyPresent: false });
          }} />
        {/if}
      </div>
    </div>
  </div>
</div>
```

CSS reuses `web/styles/settings-modal.css` if extractable, or duplicates the same pattern (~960 px wide, backdrop dim, `data-theme` inheritance). Two-column grid: `grid-template-columns: 1fr 1fr; gap: var(--sp-4);`.

- [ ] **Step 2: PasteSqlPanel**

```svelte
<script lang="ts">
  import { extractColumns } from "../lib/sql-extract.ts";
  import { basketAdd } from "../lib/basket.svelte.ts";

  interface Props {
    onAddToBasket: (info: { column: string; total: number; alreadyPresent: boolean }) => void;
  }
  let { onAddToBasket }: Props = $props();
  let sql = $state("");

  function extract() {
    const cols = extractColumns(sql);
    let added = 0;
    let lastTotal = 0;
    for (const c of cols) {
      const r = basketAdd(c);
      if (r.added) added++;
      lastTotal = r.total;
    }
    if (added > 0) {
      onAddToBasket({ column: `${added} columns from SQL`, total: lastTotal, alreadyPresent: false });
    }
  }
</script>

<section class="paste-panel">
  <label for="qa-sql">Paste SQL</label>
  <textarea id="qa-sql" rows="6" bind:value={sql} placeholder="SELECT s.SPRIDEN_ID, ..."></textarea>
  <button type="button" onclick={extract} disabled={sql.trim().length === 0}>Extract columns</button>
</section>
```

- [ ] **Step 3: BasketList**

```svelte
<script lang="ts">
  import { basketAdd } from "../lib/basket.svelte.ts";

  interface Props {
    columns: string[];
    onremove: (column: string) => void;
    onclear: () => void;
    onAddToBasket: (info: { column: string; total: number; alreadyPresent: boolean }) => void;
  }
  let { columns, onremove, onclear, onAddToBasket }: Props = $props();

  let manualInput = $state("");
  let suggestions = $state<string[]>([]);

  async function fetchSuggestions(prefix: string) {
    if (prefix.length < 2) { suggestions = []; return; }
    const r = await fetch("/api/query-analyser/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix }),
    });
    if (r.ok) suggestions = (await r.json()).matches ?? [];
  }

  function addManual(name: string) {
    const result = basketAdd(name);
    onAddToBasket({ column: name, total: result.total, alreadyPresent: !result.added });
    manualInput = "";
    suggestions = [];
  }

  function onManualKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && manualInput.trim()) {
      e.preventDefault();
      addManual(manualInput.trim());
    }
  }

  $effect(() => { fetchSuggestions(manualInput); });
</script>

<section class="basket-list">
  <header>
    <span>Basket ({columns.length})</span>
    {#if columns.length > 0}<button type="button" onclick={onclear}>Clear all</button>{/if}
  </header>

  {#if columns.length === 0}
    <p class="empty">No columns yet. Paste SQL above or click [+] on any column in the app.</p>
  {:else}
    <ul>
      {#each columns as c}
        <li><span>{c}</span><button type="button" onclick={() => onremove(c)} title="Remove">×</button></li>
      {/each}
    </ul>
  {/if}

  <div class="manual-add">
    <input type="text" placeholder="Add column…" bind:value={manualInput} onkeydown={onManualKeydown} />
    {#if suggestions.length > 0}
      <ul class="suggestions">
        {#each suggestions as s}
          <li><button type="button" onclick={() => addManual(s)}>{s}</button></li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
```

- [ ] **Step 4: ResultSets**

```svelte
<script lang="ts">
  interface SetApi {
    family: string; resource: string; version: string; releaseStatus: string | null;
    covers: string[]; apiId: number;
  }
  interface PickedSet { covers: number; of: number; apis: SetApi[]; joinHints: string[]; }
  interface Props { sets: PickedSet[]; }
  let { sets }: Props = $props();

  function apiHref(a: SetApi): string {
    return `/apis/${encodeURIComponent(a.family)}/${encodeURIComponent(a.resource)}`;
  }
</script>

<section class="result-sets">
  <header>Sets</header>
  {#if sets.length === 0}
    <p class="empty">No matching APIs found.</p>
  {:else}
    {#each sets as s, i}
      <article class="set-card">
        <div class="set-head">
          <span class="set-name">Set {i + 1}</span>
          <span class="coverage" class:full={s.covers === s.of}>covers {s.covers}/{s.of}</span>
        </div>
        {#each s.apis as a}
          <div class="api-row">
            <a href={apiHref(a)} target="_blank" rel="noopener">/{a.resource}/v{a.version}</a>
            <div class="cols">{a.covers.join(", ")}</div>
          </div>
        {/each}
        {#if s.joinHints.length > 0}
          <div class="join">Join hint: {s.joinHints.join(", ")} — stitch on these.</div>
        {/if}
      </article>
    {/each}
  {/if}
</section>
```

- [ ] **Step 5: GapPanel**

```svelte
<script lang="ts">
  type Gap =
    | { column: string; classification: { kind: "typo"; suggestions: string[] } }
    | { column: string; classification: { kind: "lineage-only"; appearsInApis: number[] } }
    | { column: string; classification: { kind: "ellucian-gap" } };

  interface Props {
    gaps: Gap[];
    onAcceptSuggestion: (original: string, suggestion: string) => void;
  }
  let { gaps, onAcceptSuggestion }: Props = $props();

  const typos = $derived(gaps.filter((g) => g.classification.kind === "typo"));
  const lineage = $derived(gaps.filter((g) => g.classification.kind === "lineage-only"));
  const ellucian = $derived(gaps.filter((g) => g.classification.kind === "ellucian-gap"));
</script>

{#if gaps.length > 0}
  <section class="gap-panel">
    <header>Gaps ({gaps.length})</header>

    {#if typos.length > 0}
      <div class="bucket">
        <h4>typo ({typos.length})</h4>
        {#each typos as g}
          {#if g.classification.kind === "typo"}
            <div class="row">
              <s>{g.column}</s> →
              {#each g.classification.suggestions as s}
                <button type="button" onclick={() => onAcceptSuggestion(g.column, s)}>{s}</button>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    {#if ellucian.length > 0}
      <div class="bucket">
        <h4>ellucian-gap ({ellucian.length})</h4>
        <ul>{#each ellucian as g}<li>{g.column}</li>{/each}</ul>
      </div>
    {/if}

    {#if lineage.length > 0}
      <div class="bucket">
        <h4>lineage-only ({lineage.length})</h4>
        <ul>{#each lineage as g}<li title="appears in {g.classification.kind === 'lineage-only' ? g.classification.appearsInApis.length : 0} APIs as a lineage reference">{g.column}</li>{/each}</ul>
      </div>
    {/if}
  </section>
{/if}
```

- [ ] **Step 6: Typecheck**

`./bun.exe run typecheck`

---

## Task 10: Manual smoke

With `npm run dev` running against the real catalog, walk the spec § "Manual smoke" list:

- [ ] Click `+` on `SPRIDEN_ID` in the column dictionary sidebar → toast appears, chip increments to `Q  1`.
- [ ] Open command palette → "Open Query Analyser" → modal opens with `SPRIDEN_ID` listed in basket.
- [ ] Paste a small SQL fragment with 4 known columns → "Extract columns" → basket grows to 5.
- [ ] Verify the right pane renders ranked sets with at least one join hint.
- [ ] Type a deliberately-typo'd column (`SPRDEN_ID`) into the manual-add field → press Enter → it appears in the basket → typo bucket suggests `SPRIDEN_ID` → click suggestion → basket swaps the typo for the real column.
- [ ] Close modal, refresh browser, reopen modal → basket persisted (localStorage round-trip).
- [ ] Press `Ctrl+Q` from any route → modal opens; press `Escape` → modal closes.
- [ ] Confirm the chip's `count` "pops" briefly when a `+` button is clicked elsewhere (the `{#key basketCount}` re-mount triggers the animation).
- [ ] Check the chip styling matches the env-selector: dim by default, accent on the count when populated, no fill, no radius, mono font.

Report any UX rough edges back to the user before declaring done. Common things worth noting:
- Toast collisions if the user clicks `+` rapidly across multiple columns (each call resets the timer; that's correct).
- Suggestions dropdown z-index inside the modal (must be above the modal body, below the modal backdrop).
- `+` button visual noise on the column-dict sidebar — the hover-only rule is a first guess; the user may want it visible always or behind a single "show add buttons" preference.

---

## Open questions deferred to implementation

- **Toast extraction:** if the toast pattern is wanted elsewhere later (e.g. clipboard-copy confirmations in the Try panel), extract `web/lib/toast.svelte.ts` then. For Wave 1, inline in App.svelte.
- **Recipes ("Copy as code"):** Wave 1.5. The Set card has horizontal room for a `[Copy recipe ▾]` button when added later; no layout slot is reserved by Wave 1 (additive change).
- **Lineage graph integration:** Wave 2 may add a "Show lineage" link on each set card.
- **Server-side basket:** explicitly out of scope; localStorage matches the rest of the single-user-single-device app (theme, layout, sidebar all use it).
- **Naming `server/migration/` vs. `server/query-analyser/`:** spec says `migration` because Phase 3's umbrella is "migration workflow." If a second migration tool ships in Wave 1.5 / 2, the directory will house both. If not, consider renaming to `server/query-analyser/` after Wave 1 ships. Don't pre-emptively rename now — wait for the second user.
