<script lang="ts">
  import type { DecomposedTable, Json } from "../types.ts";
  import { decompose } from "../shape.ts";
  import DataTable from "../DataTable.svelte";
  import TableRail from "../TableRail.svelte";

  type Props = {
    /** The parsed JSON body. null if parsing failed or body wasn't JSON. */
    json: Json | null;
    contentType: string | null;
    bodyText: string;
    /** Called when a chip cell is clicked (lift to ResponsePanel → flip tab). */
    onJumpToRaw: (jumpPath: string) => void;
  };
  let { json, contentType, bodyText, onJumpToRaw }: Props = $props();

  const MENU_WIDTH = 220;

  const tables = $derived<DecomposedTable[]>(json === null ? [] : decompose(json));
  let selectedPath = $state<string>("");
  let navFilter = $state<string | number | null>(null);

  // Hidden-column state lives here now so the "Columns ▾" menu can render
  // in the crumbs bar above DataTable.
  let hiddenCols = $state<Set<string>>(new Set());

  // Columns-menu open + anchor for position:fixed placement.
  let columnsMenuOpen = $state<boolean>(false);
  let columnsAnchorRect = $state<DOMRect | null>(null);

  $effect(() => {
    // Whenever the table list changes, pick a sane default selection.
    if (tables.length === 0) return;
    if (!tables.find((t) => t.path === selectedPath)) {
      selectedPath = tables[0].path;
      navFilter = null;
    }
  });

  $effect(() => {
    // When the user navigates to a different table, reset hiddenCols.
    // columnsMenuOpen is intentionally NOT reset — it closes via its own
    // outside-click / Escape handlers.
    //
    // navFilter is NOT reset here either: the count-link click handler sets
    // `selectedPath = p; navFilter = pid` together, and an unconditional
    // reset on selectedPath change would clobber the just-set navFilter
    // before it could take effect. The rail / breadcrumb handlers already
    // set `navFilter = null` explicitly when they want it cleared.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = selectedPath;
    hiddenCols = new Set();
  });

  const selectedTable = $derived<DecomposedTable | null>(
    tables.find((t) => t.path === selectedPath) ?? null,
  );

  const displayedTable = $derived.by<DecomposedTable | null>(() => {
    if (!selectedTable) return null;
    if (navFilter === null) return selectedTable;
    const keyCol = selectedTable.columns.find(
      (c) => c.kind === "synthetic" && (c.key === "_parent_id" || c.key === "_parent_idx"),
    );
    if (!keyCol) return selectedTable;
    const filteredRows = selectedTable.rows.filter((row) => {
      const cell = row[keyCol.key];
      return cell?.kind === "scalar" && cell.value === navFilter;
    });
    return { ...selectedTable, rows: filteredRows };
  });

  const breadcrumbs = $derived.by(() => {
    if (!selectedTable) return [] as DecomposedTable[];
    const chain: DecomposedTable[] = [];
    let current: DecomposedTable | undefined = selectedTable;
    while (current) {
      chain.unshift(current);
      const parent: DecomposedTable | undefined = current.parentPath
        ? tables.find((t) => t.path === current!.parentPath)
        : undefined;
      current = parent;
    }
    return chain;
  });

  const allCount = $derived(displayedTable ? displayedTable.columns.length : 0);
  const visibleCount = $derived(Math.max(0, allCount - hiddenCols.size));

  // Position-fixed anchor math for the Columns ▾ dropdown.
  const columnsMenuLeft = $derived.by(() => {
    if (!columnsAnchorRect) return 0;
    return columnsAnchorRect.right + MENU_WIDTH > window.innerWidth
      ? Math.max(8, columnsAnchorRect.right - MENU_WIDTH)
      : columnsAnchorRect.left;
  });
  const columnsMenuTop = $derived(columnsAnchorRect ? columnsAnchorRect.bottom + 4 : 0);

  // ───────────────────── handlers ─────────────────────

  function toggleHidden(colKey: string) {
    const next = new Set(hiddenCols);
    if (next.has(colKey)) next.delete(colKey);
    else next.add(colKey);
    hiddenCols = next;
  }

  function showAll() {
    hiddenCols = new Set();
  }

  function hideAll() {
    if (!selectedTable) return;
    hiddenCols = new Set(selectedTable.columns.map((c) => c.key));
  }

  function openColumnsMenu(e: MouseEvent) {
    e.stopPropagation();
    if (columnsMenuOpen) {
      columnsMenuOpen = false;
      columnsAnchorRect = null;
      return;
    }
    columnsAnchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    columnsMenuOpen = true;
  }

  function closeColumnsMenu() {
    columnsMenuOpen = false;
    columnsAnchorRect = null;
  }

  function onWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (columnsMenuOpen && !target.closest(".columns-menu, .columns-btn")) {
      closeColumnsMenu();
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && columnsMenuOpen) closeColumnsMenu();
  }

  function onWindowScrollOrResize() {
    if (columnsMenuOpen) closeColumnsMenu();
  }
</script>

<svelte:window
  onclick={onWindowClick}
  onkeydown={onWindowKey}
  onscroll={onWindowScrollOrResize}
  onresize={onWindowScrollOrResize}
/>

<section class="table-tab">
  {#if json === null}
    <div class="not-tabular">
      <p>Not JSON — see <strong>Raw</strong>.</p>
      <p class="dim">Content-Type: <code>{contentType ?? "(none)"}</code> · {bodyText.length} B</p>
    </div>
  {:else if tables.length === 0}
    <div class="not-tabular">
      <p>Not tabular — see <strong>Raw</strong>.</p>
      <p class="dim">Root is a scalar value.</p>
    </div>
  {:else}
    <div class="layout">
      {#if tables.length > 1}
        <TableRail
          tables={tables}
          activePath={selectedPath}
          onSelect={(p) => { selectedPath = p; navFilter = null; }}
        />
      {/if}
      <div class="content">
        {#if selectedTable && displayedTable}
          <div class="crumbs">
            <span class="path-label">
              {#if breadcrumbs.length > 1}
                {#each breadcrumbs as crumb, i}
                  {#if i > 0}<span class="sep"> / </span>{/if}
                  {#if i < breadcrumbs.length - 1}
                    <a onclick={() => { selectedPath = crumb.path; navFilter = null; }} role="button" tabindex="0">{crumb.label}</a>
                  {:else}
                    <strong>{crumb.label}</strong>
                  {/if}
                {/each}
              {:else}
                <strong>{selectedTable.label}</strong>
              {/if}
            </span>
            <span class="meta-group">
              <span class="meta">
                {displayedTable.rows.length} rows ·
                {#if hiddenCols.size > 0}
                  {visibleCount} of {allCount} cols
                {:else}
                  {allCount} cols
                {/if}
                {#if selectedTable.rangeNote}&nbsp;· heterogeneous run {selectedTable.rangeNote}{/if}
              </span>
              <button
                class="columns-btn"
                onclick={openColumnsMenu}
                disabled={allCount === 0}
              >Columns ▾</button>
            </span>
          </div>
          {#if navFilter !== null}
            <div class="filter-banner">
              Filtering by parent: <code>{navFilter}</code>
              <span class="dim">· {displayedTable.rows.length} of {selectedTable.rows.length} rows</span>
              <button onclick={() => (navFilter = null)} aria-label="Clear filter">× clear</button>
            </div>
          {/if}
          <DataTable
            table={displayedTable}
            hiddenCols={hiddenCols}
            onToggleHidden={toggleHidden}
            onNavigate={(p, pid) => { selectedPath = p; navFilter = pid ?? null; }}
            onJumpToRaw={onJumpToRaw}
          />
        {/if}
      </div>
    </div>
  {/if}
</section>

{#if columnsMenuOpen && columnsAnchorRect && selectedTable}
  <div
    class="columns-menu"
    role="menu"
    style="top:{columnsMenuTop}px; left:{columnsMenuLeft}px;"
  >
    <div class="menu-label">Visible columns</div>
    {#each selectedTable.columns as col (col.key)}
      <button
        class="menu-item checkbox-item"
        role="menuitemcheckbox"
        aria-checked={!hiddenCols.has(col.key)}
        onclick={() => toggleHidden(col.key)}
      >
        <span class="checkmark">{hiddenCols.has(col.key) ? "☐" : "☑"}</span>
        <span class="check-label">{col.key}</span>
        {#if hiddenCols.has(col.key)}<span class="dim">(hidden)</span>{/if}
      </button>
    {/each}
    <hr />
    <button class="menu-item" onclick={() => { showAll(); }}>Show all</button>
    <button class="menu-item" onclick={() => { hideAll(); }}>Hide all</button>
    <button class="menu-item" onclick={() => { showAll(); }}>Restore defaults</button>
  </div>
{/if}

<style>
  .table-tab { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  /* Always flex — the rail is conditionally rendered, so the rail-less
     single-table case naturally gets the full width via flex:1 on .content.
     Switching to `display:block` here breaks the min-height:0 chain that
     lets DataTable's overflow:auto establish a bounded scrolling viewport. */
  .layout { display: flex; flex: 1; min-height: 0; }
  .content { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .crumbs {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    padding: 4px var(--space-3);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-dim);
  }
  .crumbs a {
    color: var(--fg-dim);
    border-bottom: 1px dashed var(--border);
    cursor: pointer;
  }
  .crumbs a:hover { color: var(--accent); }
  .crumbs strong { color: var(--fg); font-weight: normal; }
  .crumbs .sep { color: var(--fg-dim); padding: 0 4px; }
  .crumbs .meta { color: var(--fg-dim); }
  .meta-group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .columns-btn {
    font: inherit;
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 1px 8px;
    cursor: pointer;
    font-size: 10.5px;
  }
  .columns-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .columns-btn:disabled { color: var(--fg-dim); cursor: default; }
  .filter-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 4px var(--space-3);
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-panel) 85%);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg);
    font-family: var(--font-mono);
  }
  .filter-banner code {
    font-family: inherit;
    background: var(--bg-raised);
    padding: 1px 6px;
    border: 1px solid var(--border);
  }
  .filter-banner .dim { color: var(--fg-dim); }
  .filter-banner button {
    margin-left: auto;
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 1px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .filter-banner button:hover { color: var(--accent); border-color: var(--accent); }
  .not-tabular {
    padding: var(--space-5);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .not-tabular p { margin: var(--space-2) 0; }
  .dim { color: var(--fg-dim); font-size: 11px; }
  code { font-family: var(--font-mono); }

  /* Columns dropdown — rendered at top level with position:fixed so it
     escapes any ancestor overflow/stacking context. */
  .columns-menu {
    position: fixed;
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    z-index: 100;
    min-width: 220px;
    max-height: 320px;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: none;
    letter-spacing: normal;
  }
  .menu-label {
    padding: 4px 12px;
    color: var(--fg-dim);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    background: transparent;
    color: var(--fg);
    border: none;
    cursor: pointer;
    padding: 4px 12px;
    font-size: 11px;
  }
  .menu-item:hover:not(:disabled) { background: var(--bg-raised); color: var(--accent); }
  .menu-item:disabled { color: var(--fg-dim); cursor: default; opacity: 0.6; }
  .checkbox-item { display: flex; align-items: center; gap: 6px; }
  .checkmark { font-family: var(--font-mono); width: 14px; text-align: center; }
  .check-label { flex: 1; font-family: var(--font-mono); }
  .columns-menu .dim { color: var(--fg-dim); font-size: 10.5px; }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2px 0;
  }
</style>
