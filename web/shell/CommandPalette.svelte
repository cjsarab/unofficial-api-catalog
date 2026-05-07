<script lang="ts">
  type ApiHit = {
    api_id: number;
    family: string;
    resource: string;
    version: string;
    title: string | null;
    source_system: string | null;
    source_domain: string | null;
    release_status: string | null;
  };
  type ColumnHit = { column_name: string; api_count: number };
  type TableHit = { table: string; api_count: number };
  type FamilyHit = { family: string; api_count: number };
  type SearchResult = {
    q: string;
    filters: Record<string, string>;
    apis: ApiHit[];
    columns: ColumnHit[];
    tables: TableHit[];
    families: FamilyHit[];
  };

  type Item =
    | { kind: "api"; api: ApiHit }
    | { kind: "column"; column: ColumnHit }
    | { kind: "table"; table: TableHit }
    | { kind: "family"; family: FamilyHit };

  type Props = {
    open: boolean;
    onClose: () => void;
    onSelectApi: (family: string, resource: string, version?: string) => void;
    onSelectColumn: (name: string) => void;
    onSelectTable: (name: string) => void;
  };
  let { open, onClose, onSelectApi, onSelectColumn, onSelectTable }: Props = $props();

  let query = $state("");
  let data = $state<SearchResult | null>(null);
  let loading = $state(false);
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let queryTimer: ReturnType<typeof setTimeout> | undefined;

  // Reset on open, focus input.
  $effect(() => {
    if (open) {
      query = "";
      data = null;
      selectedIndex = 0;
      // Defer focus so the element exists.
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  async function runSearch(q: string) {
    loading = true;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      if (res.ok) {
        data = (await res.json()) as SearchResult;
        selectedIndex = 0;
      }
    } finally {
      loading = false;
    }
  }

  function onInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
    clearTimeout(queryTimer);
    if (query.trim().length === 0) {
      data = null;
      return;
    }
    queryTimer = setTimeout(() => runSearch(query.trim()), 120);
  }

  // Build a flat list of items in display order so keyboard nav can walk them.
  const flatItems = $derived.by((): Item[] => {
    if (!data) return [];
    const items: Item[] = [];
    for (const api of data.apis) items.push({ kind: "api", api });
    for (const col of data.columns) items.push({ kind: "column", column: col });
    for (const tbl of data.tables) items.push({ kind: "table", table: tbl });
    for (const fam of data.families) items.push({ kind: "family", family: fam });
    return items;
  });

  function handleSelect(item: Item) {
    onClose();
    if (item.kind === "api") onSelectApi(item.api.family, item.api.resource, item.api.version);
    else if (item.kind === "column") onSelectColumn(item.column.column_name);
    else if (item.kind === "table") onSelectTable(item.table.table);
    else if (item.kind === "family") {
      // No family profile page yet; navigate to first API in that family as a
      // stepping stone, or just stay on overview. For now, close only.
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatItems.length > 0) selectedIndex = (selectedIndex + 1) % flatItems.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatItems.length > 0) selectedIndex = (selectedIndex - 1 + flatItems.length) % flatItems.length;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) handleSelect(item);
      return;
    }
  }

  function isSelected(globalIndex: number) {
    return globalIndex === selectedIndex;
  }

  const fmt = (n: number) => n.toLocaleString("en-US");
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div class="palette" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
      <div class="input-row">
        <span class="icon">⌕</span>
        <input
          bind:this={inputEl}
          type="text"
          placeholder="search APIs, columns, tables, families… · try col:SPRID · fam:banner · dom:student · status:beta"
          value={query}
          oninput={onInput}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="hint">Esc to close</span>
      </div>

      {#if !query.trim()}
        <div class="empty-hint">
          <div class="label">filters</div>
          <dl>
            <dt>fam:&lt;text&gt;</dt><dd>only APIs in matching families (e.g. <code>fam:banner</code>)</dd>
            <dt>sys:&lt;text&gt;</dt><dd>source system — <code>banner</code>, <code>colleague</code>, <code>apply</code>…</dd>
            <dt>dom:&lt;text&gt;</dt><dd>domain — <code>dom:student</code>, <code>dom:finance</code></dd>
            <dt>status:&lt;x&gt;</dt><dd><code>status:ga</code>, <code>status:beta</code></dd>
            <dt>col: / tbl: / api:</dt><dd>scope results to one section</dd>
          </dl>
          <div class="nav-hint">↑↓ move · Enter open · Esc close</div>
        </div>
      {:else if loading && !data}
        <div class="status">Searching…</div>
      {:else if data && flatItems.length === 0}
        <div class="status">No matches.</div>
      {:else if data}
        <div class="results">
          {#if Object.keys(data.filters).length > 0}
            <div class="applied-filters">
              {#each Object.entries(data.filters) as [k, v]}
                <span class="filter-chip">{k}:{v}</span>
              {/each}
            </div>
          {/if}

          {#if data.apis.length}
            <div class="section-head">APIs</div>
            <ul class="items">
              {#each data.apis as api, i}
                {@const idx = i}
                <li class:selected={isSelected(idx)}>
                  <button
                    class="item"
                    onmouseenter={() => (selectedIndex = idx)}
                    onclick={() => handleSelect({ kind: "api", api })}
                  >
                    <span class="badge badge-kind">api</span>
                    <span class="label-main">
                      <span class="dim">{api.family.replace(/APIs$/, "")}</span>
                      <span class="sep">/</span>
                      {api.resource}
                      <span class="dim">/</span>
                      <span class="dim">{api.version}</span>
                    </span>
                    <span class="label-meta">
                      {#if api.title}<span class="dim ellipsis">{api.title}</span>{/if}
                      {#if api.release_status && api.release_status !== "ga"}
                        <span class="status-chip">{api.release_status}</span>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          {#if data.columns.length}
            <div class="section-head">Columns</div>
            <ul class="items">
              {#each data.columns as col, i}
                {@const idx = data.apis.length + i}
                <li class:selected={isSelected(idx)}>
                  <button
                    class="item"
                    onmouseenter={() => (selectedIndex = idx)}
                    onclick={() => handleSelect({ kind: "column", column: col })}
                  >
                    <span class="badge badge-kind">col</span>
                    <span class="label-main col-name">{col.column_name}</span>
                    <span class="label-meta"><span class="dim">{fmt(col.api_count)} APIs</span></span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          {#if data.tables.length}
            <div class="section-head">Tables</div>
            <ul class="items">
              {#each data.tables as tbl, i}
                {@const idx = data.apis.length + data.columns.length + i}
                <li class:selected={isSelected(idx)}>
                  <button
                    class="item"
                    onmouseenter={() => (selectedIndex = idx)}
                    onclick={() => handleSelect({ kind: "table", table: tbl })}
                  >
                    <span class="badge badge-kind">tbl</span>
                    <span class="label-main tbl-name">{tbl.table}</span>
                    <span class="label-meta"><span class="dim">{fmt(tbl.api_count)} APIs</span></span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          {#if data.families.length}
            <div class="section-head">Families</div>
            <ul class="items">
              {#each data.families as fam, i}
                {@const idx = data.apis.length + data.columns.length + data.tables.length + i}
                <li class:selected={isSelected(idx)}>
                  <button
                    class="item"
                    onmouseenter={() => (selectedIndex = idx)}
                    onclick={() => handleSelect({ kind: "family", family: fam })}
                  >
                    <span class="badge badge-kind">fam</span>
                    <span class="label-main">{fam.family}</span>
                    <span class="label-meta"><span class="dim">{fmt(fam.api_count)} APIs</span></span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    display: grid;
    place-items: start center;
    padding-top: 10vh;
    z-index: 1000;
  }
  .palette {
    width: min(680px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .input-row .icon { color: var(--fg-dim); font-size: 16px; }
  .input-row input {
    flex: 1;
    font: inherit;
    font-size: 13px;
    background: transparent;
    color: var(--fg-bright);
    border: none;
    outline: none;
    padding: 4px 0;
  }
  .input-row input::placeholder { color: var(--fg-dim); opacity: 0.7; }
  .input-row .hint {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-dim);
    padding: 2px 6px;
    border: 1px solid var(--border);
  }

  .status, .empty-hint {
    padding: var(--space-4) var(--space-4);
    color: var(--fg-dim);
    font-size: 12px;
  }
  .empty-hint .label {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-dim);
    margin-bottom: var(--space-2);
  }
  .empty-hint dl {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 2px var(--space-3);
    margin: 0;
    font-size: 11.5px;
  }
  .empty-hint dt {
    color: var(--fg);
    font-family: var(--font-mono);
  }
  .empty-hint dd {
    margin: 0;
    color: var(--fg-dim);
  }
  .empty-hint code {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 0 4px;
    color: var(--fg);
  }
  .empty-hint .nav-hint {
    margin-top: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px dotted var(--border);
    font-size: 10.5px;
  }

  .results { overflow: auto; flex: 1; }
  .applied-filters {
    display: flex;
    gap: 6px;
    padding: 6px var(--space-4);
    border-bottom: 1px dotted var(--border);
  }
  .filter-chip {
    font-size: 10px;
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 1px 8px;
    font-family: var(--font-mono);
  }

  .section-head {
    padding: 8px var(--space-4) 4px;
    color: var(--fg-dim);
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    background: var(--bg-raised);
    border-top: 1px solid var(--border);
    border-bottom: 1px dotted var(--border);
    position: sticky;
    top: 0;
  }
  ul.items { list-style: none; margin: 0; padding: 0; }
  ul.items li.selected { background: var(--border); }

  .item {
    display: grid;
    grid-template-columns: 42px 1fr minmax(0, 1fr);
    gap: var(--space-3);
    align-items: center;
    width: 100%;
    padding: 5px var(--space-4);
    font: inherit;
    background: transparent;
    border: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
  }
  .item:hover { color: var(--accent); }
  .badge-kind {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: center;
    padding: 1px 6px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    font-family: var(--font-mono);
  }
  .label-main {
    font-size: 12px;
    color: var(--fg-bright);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label-main .dim { color: var(--fg-dim); }
  .label-main .sep { color: var(--fg-dim); margin: 0 1px; }
  .label-main.col-name { color: var(--fg-bright); font-family: var(--font-mono); }
  .label-main.tbl-name { color: var(--warn); font-family: var(--font-mono); }
  .label-meta {
    font-size: 11px;
    color: var(--fg-dim);
    text-align: right;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    overflow: hidden;
  }
  .label-meta .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-chip {
    font-size: 9px;
    letter-spacing: 0.06em;
    color: var(--warn);
    border: 1px solid var(--warn);
    padding: 0 5px;
    text-transform: uppercase;
  }
</style>
