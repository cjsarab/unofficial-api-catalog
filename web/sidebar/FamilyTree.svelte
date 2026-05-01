<script lang="ts">
  type VersionRow = {
    version: string;
    id: number;
    title: string | null;
    sourceDomain: string | null;
    releaseStatus: string | null;
  };
  type Resource = { resource: string; versions: VersionRow[] };
  type Family = { family: string; resourceCount: number; resources: Resource[] };

  type Props = {
    onSelectApi: (family: string, resource: string, version?: string) => void;
    selectedFamily?: string;
    selectedResource?: string;
  };
  let { onSelectApi, selectedFamily, selectedResource }: Props = $props();

  let families = $state<Family[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let expanded = $state(new Set<string>());
  let query = $state("");

  const EXPAND_STORAGE = "acx:family-expanded:v1";

  $effect(() => {
    restoreExpansion();
    load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch("/api/families/tree");
      if (!res.ok) {
        error = `server responded ${res.status}`;
        return;
      }
      const body = (await res.json()) as { families: Family[] };
      families = body.families;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function restoreExpansion() {
    try {
      const saved = localStorage.getItem(EXPAND_STORAGE);
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        expanded = new Set(arr);
      }
    } catch {
      /* ignore */
    }
  }

  function persistExpansion() {
    try {
      localStorage.setItem(EXPAND_STORAGE, JSON.stringify([...expanded]));
    } catch {
      /* ignore */
    }
  }

  function toggle(family: string) {
    const next = new Set(expanded);
    if (next.has(family)) next.delete(family);
    else next.add(family);
    expanded = next;
    persistExpansion();
  }

  function pickDefaultVersion(versions: VersionRow[]): VersionRow {
    // Prefer newest 'ga'; fall back to newest of any status.
    const sortedNewestFirst = [...versions].sort((a, b) => compareVersions(b.version, a.version));
    return sortedNewestFirst.find((v) => v.releaseStatus === "ga") ?? sortedNewestFirst[0]!;
  }

  function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map((p) => Number(p) || 0);
    const pb = b.split(".").map((p) => Number(p) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  const fmt = (n: number) => n.toLocaleString("en-US");

  // When filtering, show a flat list of matching resources across all families
  // (dropping the family-row rollups). Matches against resource name + title,
  // case-insensitive substring. Prefix hits rank first.
  type FilteredRow = {
    family: string;
    resource: string;
    versions: VersionRow[];
    score: number;
  };
  const filtered = $derived.by((): FilteredRow[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: FilteredRow[] = [];
    for (const f of families) {
      for (const r of f.resources) {
        const name = r.resource.toLowerCase();
        const title = (r.versions[0]?.title ?? "").toLowerCase();
        const nameStart = name.startsWith(q);
        const nameHit = name.includes(q);
        const titleHit = title.includes(q);
        if (nameHit || titleHit) {
          hits.push({
            family: f.family,
            resource: r.resource,
            versions: r.versions,
            score: nameStart ? 0 : nameHit ? 1 : 2,
          });
        }
      }
    }
    hits.sort((a, b) =>
      a.score !== b.score ? a.score - b.score : a.resource.localeCompare(b.resource),
    );
    return hits.slice(0, 500);
  });
</script>

<div class="filter">
  <input
    type="search"
    placeholder="filter APIs (resource or title)"
    spellcheck="false"
    value={query}
    oninput={(e) => (query = (e.target as HTMLInputElement).value)}
  />
  {#if query}
    <button class="clear-btn" onclick={() => (query = "")} title="Clear filter">×</button>
  {/if}
</div>

{#if loading}
  <p class="dim small pad">Loading families…</p>
{:else if error}
  <p class="error pad">Could not load tree: {error}</p>
{:else if query.trim()}
  {#if filtered.length === 0}
    <p class="dim small pad">No resources match.</p>
  {:else}
    <ul class="families">
      {#each filtered as row}
        {@const def = pickDefaultVersion(row.versions)}
        <li>
          <button
            class="row filter-row"
            class:active={selectedFamily === row.family && selectedResource === row.resource}
            onclick={() => onSelectApi(row.family, row.resource, def.version)}
            title={def.title ?? row.resource}
          >
            <span class="name">{row.resource}</span>
            <span class="family-hint">{row.family.replace(/APIs$/, "")}</span>
            {#if row.versions.length > 1}
              <span class="version-badge">×{row.versions.length}</span>
            {/if}
            {#if def.releaseStatus && def.releaseStatus !== "ga"}
              <span class="status-badge status-{def.releaseStatus}">{def.releaseStatus}</span>
            {/if}
          </button>
        </li>
      {/each}
      {#if filtered.length >= 500}
        <li class="more pad">
          <p class="dim small">showing first 500 matches — narrow the filter</p>
        </li>
      {/if}
    </ul>
  {/if}
{:else}
  <ul class="families">
    {#each families as f}
      <li class="family">
        <button class="row family-row" class:expanded={expanded.has(f.family)} onclick={() => toggle(f.family)}>
          <span class="chevron">{expanded.has(f.family) ? "▾" : "▸"}</span>
          <span class="name">{f.family}</span>
          <span class="count">{fmt(f.resourceCount)}</span>
        </button>

        {#if expanded.has(f.family)}
          <ul class="resources">
            {#each f.resources as r}
              {@const def = pickDefaultVersion(r.versions)}
              <li>
                <button
                  class="row resource-row"
                  class:active={selectedFamily === f.family && selectedResource === r.resource}
                  onclick={() => onSelectApi(f.family, r.resource, def.version)}
                  title={r.versions.length > 1 ? `${r.versions.length} versions` : def.version}
                >
                  <span class="name">{r.resource}</span>
                  {#if r.versions.length > 1}
                    <span class="version-badge" title={r.versions.map((v) => v.version).join(", ")}>
                      ×{r.versions.length}
                    </span>
                  {/if}
                  {#if def.releaseStatus && def.releaseStatus !== "ga"}
                    <span class="status-badge status-{def.releaseStatus}">{def.releaseStatus}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .pad { padding: var(--space-3) var(--space-4); }
  .dim { color: var(--fg-dim); font-size: var(--fs-sm); }
  .error { color: var(--danger); font-size: var(--fs-sm); }
  .small { font-size: var(--fs-sm); }

  ul { list-style: none; margin: 0; padding: 0; }
  ul.families { padding: var(--space-0) 0; }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    width: 100%;
    font: inherit;
    background: transparent;
    border: none;
    color: var(--fg);
    padding: var(--space-0) var(--space-2) var(--space-0) var(--space-1-5);
    cursor: pointer;
    text-align: left;
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
  }
  .row:hover { background: var(--bg-raised); color: var(--accent); }
  .row.active { background: var(--border); color: var(--accent); }

  .family-row {
    font-weight: 500;
    color: var(--fg-bright);
  }
  .family-row .chevron {
    width: 12px;
    text-align: center;
    font-size: 9px;
    color: var(--fg-dim);
  }

  .resource-row {
    padding-left: 28px;
    color: var(--fg);
    font-size: var(--fs-sm);
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    color: var(--fg-dim);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }

  .version-badge {
    font-size: 9px;
    color: var(--fg-dim);
    background: var(--bg-raised);
    padding: 0 var(--space-1);
    border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
  }
  .status-badge {
    font-size: 8.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--warn);
    border: 1px solid var(--warn);
    padding: 0 var(--space-1);
  }
  .status-badge.status-beta { color: var(--warn); border-color: var(--warn); }

  .filter {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .filter input {
    flex: 1;
    font: inherit;
    font-size: 11.5px;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: 3px var(--space-2);
  }
  .filter input:focus { outline: none; border-color: var(--accent); }
  .clear-btn {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg-dim);
    border: 1px solid var(--border-strong);
    padding: 3px 7px;
    cursor: pointer;
    line-height: 1;
  }
  .clear-btn:hover { color: var(--accent); border-color: var(--accent); }

  .filter-row {
    padding-left: var(--space-3);
  }
  .filter-row .family-hint {
    font-size: 9.5px;
    color: var(--fg-dim);
    background: var(--bg-raised);
    padding: 0 5px;
    border: 1px solid var(--border);
  }
  .more { padding: var(--space-2) 14px; }
</style>
