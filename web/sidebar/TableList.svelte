<script lang="ts">
  type TableRow = { table: string; api_count: number };

  type Props = {
    onSelectTable: (name: string) => void;
    selectedTable?: string;
  };
  let { onSelectTable, selectedTable }: Props = $props();

  let tables = $state<TableRow[]>([]);
  let query = $state("");
  let loading = $state(true);
  let showAll = $state(false);

  $effect(() => {
    load();
  });

  async function load() {
    loading = true;
    try {
      const res = await fetch("/api/tables?limit=1000");
      if (res.ok) tables = ((await res.json()) as { tables: TableRow[] }).tables;
    } finally {
      loading = false;
    }
  }

  const filtered = $derived(
    query.trim()
      ? tables.filter((t) => t.table.toLowerCase().includes(query.trim().toLowerCase()))
      : tables,
  );
  const visible = $derived(showAll ? filtered : filtered.slice(0, 40));
  const fmt = (n: number) => n.toLocaleString("en-US");
</script>

<div class="filter">
  <input
    type="search"
    placeholder="filter tables"
    spellcheck="false"
    value={query}
    oninput={(e) => (query = (e.target as HTMLInputElement).value)}
  />
  {#if query}
    <button class="clear-btn" onclick={() => (query = "")} title="Clear filter">×</button>
  {/if}
</div>

{#if loading}
  <p class="dim small pad">Loading tables…</p>
{:else if filtered.length === 0}
  <p class="dim small pad">No tables match.</p>
{:else}
  <ul>
    {#each visible as t}
      <li>
        <button
          class="row"
          class:active={selectedTable?.toUpperCase() === t.table.toUpperCase()}
          onclick={() => onSelectTable(t.table)}
        >
          <span class="name">{t.table}</span>
          <span class="count">{fmt(t.api_count)}</span>
        </button>
      </li>
    {/each}
    {#if !showAll && filtered.length > 40}
      <li class="more pad">
        <button class="link" onclick={() => (showAll = true)}>
          Show all {fmt(filtered.length)} tables
        </button>
      </li>
    {/if}
  </ul>
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
  .dim { color: var(--fg-dim); }
  .small { font-size: 11px; }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    font: inherit;
    font-size: 11.5px;
    background: transparent;
    border: none;
    color: var(--fg);
    padding: 2px 10px 2px 14px;
    cursor: pointer;
    text-align: left;
  }
  .row:hover { background: var(--bg-raised); color: var(--accent); }
  .row.active { background: var(--border); color: var(--accent); }

  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
