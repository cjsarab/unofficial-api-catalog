# Backlog

Discovered issues + quality-of-life items that aren't in scope for the active phase's plan. Each entry has a stable ID (`B-###` bug, `QOL-###` polish, `UX-###` design).

**Triage workflow:** discover → log here → triage by phase planning → move into a plan / spec when worked on → tick off below with the commit SHA.

Open items, newest at top.

---

(no open items — backlog cleared 2026-04-29)

---

## (closed items live below; moved here when shipped)

### Closed in the 2026-04-29 backlog wave

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
