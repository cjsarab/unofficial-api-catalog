# Backlog

Discovered issues + quality-of-life items that aren't in scope for the active phase's plan. Each entry has a stable ID (`B-###` bug, `QOL-###` polish, `UX-###` design).

**Triage workflow:** discover → log here → triage by phase planning → move into a plan / spec when worked on → tick off below with the commit SHA.

Open items, newest at top.

---

## B-001 — First-run wizard flashes on every app start

**Severity:** low · cosmetic · no data loss
**Reported:** 2026-04-24

On every app start, the "Point me at your APICatalog folder" screen flashes for a fraction of a second before the app realises a catalog is already configured and transitions to the main screen.

Likely cause: the landing view mounts before `GET /api/config` resolves; the route dispatcher defaults to the wizard when config is null and flips once the config arrives.

**Possible fix:** gate the root render on a `configLoaded` flag — show a minimal splash (or nothing) until the first config fetch settles, then mount the appropriate view.

---

## QOL-001 — Try panel placeholder still references "Task 15"

**Severity:** low · cosmetic
**Reported:** 2026-04-24

When no endpoint is focused, the Try panel (right slot) renders:

> Try API
> Environment-scoped request builder using the active env's Ellucian API key. Ctrl+. to collapse.
>
> **arrives in Task 15**

The "arrives in Task 15" line is a leftover `PanePlaceholder` `taskNumber` from the Phase-2 scaffolding. The Try panel has been shipped for weeks; the placeholder text for the no-endpoint state should be rewritten to a neutral "Focus an endpoint to try it" prompt.

**Files:** `web/App.svelte` right snippet, around the `<PanePlaceholder ...>` fallback.

---

## B-002 — Try panel shows "isn't in v1.0.0" error when switching APIs without explicit selection

**Severity:** medium · confusing but recoverable
**Reported:** 2026-04-24

If the user has an endpoint focused in API A, then navigates to API B's content page without explicitly clicking an endpoint there, the Try panel may render:

> This endpoint isn't in v1.0.0. Pick another, or revert the version.

Likely cause: the focused-endpoint state from API A survives the navigation; TryPanel's version-migration logic then evaluates against API B's v1.0.0 schema, doesn't find the old endpoint, and shows the orphan warning.

**Proposed fix direction:** either (a) clear `focusedEndpoint` when the route changes to a different API, so TryPanel shows the no-endpoint placeholder until the user picks an endpoint in the new API; or (b) keep the focused endpoint from API A pinned to its own version (TryPanel remains on API A's schema) until the user explicitly picks an endpoint under API B. Option (a) is probably simpler and more predictable.

---

## QOL-002 — Try panel field filter doesn't match parent field names

**Severity:** low · discoverability
**Reported:** 2026-04-24

In the Try panel's Params / Body filter, typing the name of a parent field (e.g. `Credentials` on the `/persons` endpoint) doesn't surface it as a match — only leaf-field names are searchable (`Type`, `Value` within the credentials object).

**Expected:** filter should search across the full dotted path, so typing `credentials` matches the entire `credentials.*` subtree.

**Files:** wherever the Try panel's filter predicate lives — likely `web/docs/try/ParamsTab.svelte` or `web/docs/try/BodyTab.svelte`, or a shared helper.

---

## UX-001 — Try panel colours are hard to read in `dos` and `beige` themes

**Severity:** medium · accessibility
**Reported:** 2026-04-24

The Try panel's palette doesn't render cleanly in the `dos` (Turbo-blue) and `beige` (IBM-print) themes — contrast is poor and some labels sit near-invisible.

**Fix direction:** audit every colour literal in `web/docs/try/*.svelte` and `web/docs/TryPanel.svelte`; replace hard-coded colours with theme tokens (`--fg`, `--fg-dim`, `--accent`, `--border`, `--bg-panel`, etc.). If a literal is load-bearing (e.g. a status-colour red), keep it but test against all four themes.

Related: the Response Panel's status banner also uses a hard-coded `#2a1818` / `#ffb0b0` / `#bf5050` trio — worth visiting in the same sweep.

---

## UX-002 — No home / return-to-landing button

**Severity:** low · navigation
**Reported:** 2026-04-24

The top-left area of the shell has no obvious way to return to the catalog overview / landing page once the user has drilled into an API / column / table / lineage view. Browser back works, but a persistent "home" affordance in the top bar would match user expectation.

**Fix direction:** add a small icon button or "Home" text link at the far left of the top bar (before the existing search / env selector). Clicking navigates to `/` and clears any focused API / endpoint. Alternative: make the app's title / logomark in the top bar clickable and route to `/`.

---

## (closed items live below; moved here when shipped)

<!-- none yet -->
