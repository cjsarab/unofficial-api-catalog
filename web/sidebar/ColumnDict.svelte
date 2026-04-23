<script lang="ts">
  type ColumnRow = { column_name: string; api_count: number; total_occurrences: number };
  type Prefix = { prefix: string; column_count: number; api_count: number };

  type Props = {
    onSelectColumn: (name: string) => void;
    selectedColumn?: string;
  };
  let { onSelectColumn, selectedColumn }: Props = $props();

  let query = $state("");
  let results = $state<ColumnRow[]>([]);
  let prefixes = $state<Prefix[]>([]);
  let loading = $state(false);
  let expandedPrefix = $state<string | null>(null);
  let expandedPrefixCols = $state<ColumnRow[]>([]);
  let showAllPrefixes = $state(false);

  let queryTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    loadPrefixes();
  });

  async function loadPrefixes() {
    try {
      const res = await fetch("/api/columns/prefixes");
      if (res.ok) prefixes = ((await res.json()) as { prefixes: Prefix[] }).prefixes;
    } catch {
      /* ignore */
    }
  }

  function onInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
    clearTimeout(queryTimer);
    if (query.trim().length === 0) {
      results = [];
      return;
    }
    queryTimer = setTimeout(() => runSearch(query.trim()), 150);
  }

  async function runSearch(q: string) {
    loading = true;
    try {
      const res = await fetch(`/api/columns?q=${encodeURIComponent(q)}&limit=500`);
      if (res.ok) {
        results = ((await res.json()) as { columns: ColumnRow[] }).columns;
      }
    } finally {
      loading = false;
    }
  }

  async function togglePrefix(prefix: string) {
    if (expandedPrefix === prefix) {
      expandedPrefix = null;
      expandedPrefixCols = [];
      return;
    }
    expandedPrefix = prefix;
    expandedPrefixCols = [];
    try {
      const res = await fetch(`/api/columns/prefix/${encodeURIComponent(prefix)}`);
      if (res.ok) {
        expandedPrefixCols = ((await res.json()) as { columns: ColumnRow[] }).columns;
      }
    } catch {
      /* ignore */
    }
  }

  function clearQuery() {
    query = "";
    results = [];
  }

  const fmt = (n: number) => n.toLocaleString("en-US");

  const visiblePrefixes = $derived(showAllPrefixes ? prefixes : prefixes.slice(0, 40));
</script>

<div class="filter">
  <input
    type="search"
    placeholder="filter columns (e.g. SPRIDEN, FA.YEAR)"
    spellcheck="false"
    value={query}
    oninput={onInput}
  />
  {#if query}
    <button class="clear-btn" onclick={clearQuery} title="Clear filter">×</button>
  {/if}
</div>

{#if query.trim()}
  <!-- Search results (flat) -->
  {#if loading}
    <p class="dim small pad">Searching…</p>
  {:else if results.length === 0}
    <p class="dim small pad">No columns match.</p>
  {:else}
    <ul class="flat">
      {#each results as c}
        <li>
          <button
            class="col-row"
            class:active={selectedColumn === c.column_name}
            onclick={() => onSelectColumn(c.column_name)}
          >
            <span class="name">{c.column_name}</span>
            <span class="count">{fmt(c.api_count)}</span>
          </button>
        </li>
      {/each}
      {#if results.length >= 500}
        <li class="more pad">
          <p class="dim small">showing first 500 matches — narrow the filter for more</p>
        </li>
      {/if}
    </ul>
  {/if}
{:else}
  <!-- Grouped by prefix (idle mode) -->
  {#if prefixes.length === 0}
    <p class="dim small pad">Loading column groups…</p>
  {:else}
    <ul class="groups">
      {#each visiblePrefixes as p}
        <li>
          <button class="group-row" class:expanded={expandedPrefix === p.prefix} onclick={() => togglePrefix(p.prefix)}>
            <span class="chevron">{expandedPrefix === p.prefix ? "▾" : "▸"}</span>
            <span class="name">{p.prefix}</span>
            <span class="count">{fmt(p.column_count)}</span>
          </button>
          {#if expandedPrefix === p.prefix}
            {#if expandedPrefixCols.length === 0}
              <p class="dim small pad-deep">Loading…</p>
            {:else}
              <ul class="nested">
                {#each expandedPrefixCols as c}
                  <li>
                    <button
                      class="col-row nested-row"
                      class:active={selectedColumn === c.column_name}
                      onclick={() => onSelectColumn(c.column_name)}
                    >
                      <span class="name">{c.column_name}</span>
                      <span class="count">{fmt(c.api_count)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </li>
      {/each}
      {#if !showAllPrefixes && prefixes.length > 40}
        <li class="more pad">
          <button class="link" onclick={() => (showAllPrefixes = true)}>
            Show all {fmt(prefixes.length)} prefixes
          </button>
        </li>
      {/if}
    </ul>
  {/if}
{/if}

<style>
  .filter {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
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
    padding: 3px 8px;
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

  ul { list-style: none; margin: 0; padding: 0; }

  .pad { padding: 8px 10px; }
  .pad-deep { padding: 4px 10px 4px 28px; }
  .dim { color: var(--fg-dim); }
  .small { font-size: 11px; }

  .col-row, .group-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: none;
    color: var(--fg);
    padding: 2px 10px 2px 14px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
  }
  .col-row:hover, .group-row:hover { background: var(--bg-raised); color: var(--accent); }
  .col-row.active { background: var(--border); color: var(--accent); }
  .nested-row { padding-left: 28px; font-size: 11px; }

  .group-row {
    font-weight: 500;
    color: var(--fg-bright);
  }
  .group-row .chevron {
    width: 10px;
    text-align: center;
    font-size: 9px;
    color: var(--fg-dim);
  }

  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .count { color: var(--fg-dim); font-size: 10px; font-variant-numeric: tabular-nums; }

  .more { padding: 8px 14px; }
  .link {
    background: transparent;
    border: none;
    color: var(--fg-dim);
    border-bottom: 1px dotted var(--border-strong);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    padding: 0;
  }
  .link:hover { color: var(--accent); border-bottom-color: var(--accent); }
</style>
