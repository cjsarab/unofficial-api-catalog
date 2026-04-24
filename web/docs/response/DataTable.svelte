<script lang="ts">
  import type { DecomposedTable, CellValue, Column } from "./types.ts";
  import { compareCells } from "./compare.ts";

  type Props = {
    table: DecomposedTable;
    /** Called when a count-link cell is clicked. */
    onNavigate?: (targetPath: string, parentRowId?: string | number) => void;
    /** Called when a chip cell is clicked (jump to Raw). */
    onJumpToRaw?: (jumpPath: string) => void;
  };
  let { table, onNavigate, onJumpToRaw }: Props = $props();

  const STRING_TRUNCATE = 80;
  const MIN_COL_WIDTH = 60;

  // ───────────────────────── state ─────────────────────────

  let expandedCells = $state<Set<string>>(new Set());
  let copiedCell = $state<string | null>(null);

  // Per-component feature state — resets when the user navigates to a different table.
  let sort = $state<{ col: string; dir: "asc" | "desc" } | null>(null);
  let colWidths = $state<Map<string, number>>(new Map());
  let hiddenCols = $state<Set<string>>(new Set());

  // Menu-open state — kept OUT of the reset effect so opening a menu doesn't
  // re-trigger the reset on its own state change.
  let openHeaderMenu = $state<string | null>(null); // column key whose ⋮ dropdown is open
  let columnsMenuOpen = $state<boolean>(false);

  $effect(() => {
    // Track table.path; when it changes, reset feature state.
    // Note: menu-open state intentionally NOT reset here — those close via
    // their own outside-click / Escape handlers, and keeping them out of this
    // effect avoids accidental dependency coupling.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = table.path;
    sort = null;
    colWidths = new Map();
    hiddenCols = new Set();
    expandedCells = new Set();
  });

  // ───────────────────────── helpers ─────────────────────────

  function cellKey(rowIdx: number, colKey: string): string {
    return `${rowIdx}:${colKey}`;
  }

  function renderScalar(v: string | number | boolean | null): string {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }

  function truncatedScalar(text: string): { truncated: boolean; display: string } {
    if (text.length <= STRING_TRUNCATE) return { truncated: false, display: text };
    return { truncated: true, display: text.slice(0, STRING_TRUNCATE) + "…" };
  }

  function toggleExpand(key: string) {
    const next = new Set(expandedCells);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedCells = next;
  }

  /** A column is sortable iff its first non-undefined cell is a scalar. */
  function isColumnSortable(col: Column): boolean {
    for (const row of table.rows) {
      const cell = row[col.key];
      if (cell === undefined) continue;
      return cell.kind === "scalar";
    }
    // No data yet → allow sort (trivial no-op).
    return true;
  }

  function cycleSort(col: Column) {
    if (!isColumnSortable(col)) return;
    if (!sort || sort.col !== col.key) {
      sort = { col: col.key, dir: "asc" };
    } else if (sort.dir === "asc") {
      sort = { col: col.key, dir: "desc" };
    } else {
      sort = null;
    }
  }

  function setSort(colKey: string, dir: "asc" | "desc") {
    sort = { col: colKey, dir };
  }

  function clearSort() {
    sort = null;
  }

  function hideColumn(colKey: string) {
    const next = new Set(hiddenCols);
    next.add(colKey);
    hiddenCols = next;
  }

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
    hiddenCols = new Set(table.columns.map((c) => c.key));
  }

  async function copyText(text: string, flashKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedCell = flashKey;
      setTimeout(() => {
        if (copiedCell === flashKey) copiedCell = null;
      }, 1000);
    } catch {
      // Clipboard API unavailable (non-secure context etc.); silently no-op.
    }
  }

  // ───────────────────── derived ─────────────────────

  const sortedRows = $derived.by(() => {
    if (!sort) return table.rows;
    const { col, dir } = sort;
    // Use a shallow copy so we don't mutate upstream data.
    const rows = table.rows.slice();
    rows.sort((ra, rb) => compareCells(ra[col], rb[col], dir));
    return rows;
  });

  const visibleRows = $derived(sortedRows.slice(0, 500));
  const overflowCount = $derived(Math.max(0, table.rows.length - visibleRows.length));

  const visibleColumns = $derived(table.columns.filter((c) => !hiddenCols.has(c.key)));

  // ───────────────────── resize drag ─────────────────────

  let dragState: { colKey: string; startX: number; startWidth: number } | null = null;

  function startResize(e: MouseEvent, col: Column, thEl: HTMLElement) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = colWidths.get(col.key) ?? thEl.getBoundingClientRect().width;
    dragState = { colKey: col.key, startX: e.clientX, startWidth };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onDragMove(e: MouseEvent) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const next = Math.max(MIN_COL_WIDTH, dragState.startWidth + dx);
    const m = new Map(colWidths);
    m.set(dragState.colKey, next);
    colWidths = m;
  }

  function onDragEnd() {
    dragState = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  // ───────────────────── close-on-outside-click ─────────────────────

  function onWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (openHeaderMenu !== null && !target.closest(".header-menu, .menu-btn")) {
      openHeaderMenu = null;
    }
    if (columnsMenuOpen && !target.closest(".columns-menu, .columns-btn")) {
      columnsMenuOpen = false;
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (openHeaderMenu !== null) openHeaderMenu = null;
      if (columnsMenuOpen) columnsMenuOpen = false;
    }
  }

  // ───────────────────── menu helpers ─────────────────────

  function widthStyle(colKey: string): string {
    const w = colWidths.get(colKey);
    return w ? `width:${w}px;min-width:${w}px;max-width:${w}px;` : "";
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKey} />

<div class="dt">
  <div class="toolbar">
    <span class="toolbar-meta">
      {#if hiddenCols.size > 0}
        <span class="hidden-note">({visibleColumns.length} of {table.columns.length} cols shown)</span>
      {/if}
    </span>
    <div class="columns-wrap">
      <button
        class="columns-btn"
        onclick={(e) => { e.stopPropagation(); columnsMenuOpen = !columnsMenuOpen; }}
        disabled={table.columns.length === 0}
      >Columns ▾</button>
      {#if columnsMenuOpen}
        <div class="columns-menu" role="menu">
          <div class="menu-label">Visible columns</div>
          {#each table.columns as col (col.key)}
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
    </div>
  </div>

  {#if table.columns.length === 0}
    <div class="empty">
      {table.rows.length === 0 ? "Empty — 0 rows, 0 columns" : `${table.rows.length} rows · 0 columns`}
    </div>
  {:else if visibleColumns.length === 0}
    <div class="empty">All {table.columns.length} columns hidden — use "Columns ▾" to show some.</div>
  {:else}
    <table>
      <thead>
        <tr>
          {#each visibleColumns as col (col.key)}
            {@const sortable = isColumnSortable(col)}
            {@const isSorted = sort && sort.col === col.key}
            <th
              title={col.synthNote ?? ""}
              class="kind-{col.kind}"
              class:sortable
              class:sorted={isSorted}
              style={widthStyle(col.key)}
            >
              <button
                class="header-label"
                onclick={() => sortable && cycleSort(col)}
                disabled={!sortable}
                type="button"
              >
                <span class="col-name">{col.key}</span>
                {#if isSorted && sort}
                  <span class="sort-arrow">{sort.dir === "asc" ? "▲" : "▼"}</span>
                {/if}
              </button>
              <button
                class="menu-btn"
                aria-label="Column options"
                onclick={(e) => { e.stopPropagation(); openHeaderMenu = openHeaderMenu === col.key ? null : col.key; }}
                type="button"
              >⋮</button>
              <button
                class="resize-handle"
                aria-label="Resize column"
                tabindex="-1"
                type="button"
                onmousedown={(e) => { const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement; startResize(e, col, th); }}
                onclick={(e) => e.stopPropagation()}
              ></button>
              {#if openHeaderMenu === col.key}
                <div class="header-menu" role="menu">
                  <button
                    class="menu-item"
                    disabled={!sortable || (!!sort && sort.col === col.key && sort.dir === "asc")}
                    onclick={() => { setSort(col.key, "asc"); openHeaderMenu = null; }}
                  >Sort ascending ▲</button>
                  <button
                    class="menu-item"
                    disabled={!sortable || (!!sort && sort.col === col.key && sort.dir === "desc")}
                    onclick={() => { setSort(col.key, "desc"); openHeaderMenu = null; }}
                  >Sort descending ▼</button>
                  <button
                    class="menu-item"
                    disabled={!sort || sort.col !== col.key}
                    onclick={() => { clearSort(); openHeaderMenu = null; }}
                  >Clear sort</button>
                  <hr />
                  <button class="menu-item" onclick={() => { hideColumn(col.key); openHeaderMenu = null; }}>Hide column</button>
                  <button class="menu-item" onclick={() => { copyText(col.key, `col:${col.key}`); openHeaderMenu = null; }}>Copy column name</button>
                </div>
              {/if}
            </th>
          {/each}
          {#if table.hiddenColumnCount}
            <th class="hidden-cols">+{table.hiddenColumnCount} more</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each visibleRows as row, rowIdx}
          <tr>
            {#each visibleColumns as col (col.key)}
              {@const cell = row[col.key] as CellValue | undefined}
              {@const ckey = cellKey(rowIdx, col.key)}
              <td style={widthStyle(col.key)}>
                {#if cell === undefined}
                  <span class="dim">—</span>
                {:else if cell.kind === "scalar"}
                  {@const text = renderScalar(cell.value)}
                  {@const t = truncatedScalar(text)}
                  {#if cell.value === null}
                    <span class="dim">null</span>
                  {:else if t.truncated && !expandedCells.has(ckey)}
                    <span class="cell-text" title={text}>{t.display}</span>
                    <button class="more" onclick={() => toggleExpand(ckey)}>+</button>
                  {:else if t.truncated}
                    <span class="cell-text">{text}</span>
                    <button class="more" onclick={() => toggleExpand(ckey)}>−</button>
                  {:else}
                    <span class="cell-text">{text}</span>
                  {/if}
                  {#if cell.value !== null}
                    <button
                      class="copy-btn"
                      aria-label="Copy cell value"
                      title="Copy"
                      onclick={(e) => { e.stopPropagation(); copyText(text, ckey); }}
                    >{copiedCell === ckey ? "✓" : "⧉"}</button>
                  {/if}
                {:else if cell.kind === "chip-array"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>[{cell.count}]</button>
                {:else if cell.kind === "chip-object"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>{`{${cell.keyCount}}`}</button>
                {:else if cell.kind === "count-link"}
                  <button class="chip" onclick={() => onNavigate?.(cell.targetTablePath, cell.parentRowId)}>→ {cell.count} {cell.count === 1 ? "row" : "rows"}</button>
                {/if}
              </td>
            {/each}
            {#if table.hiddenColumnCount}
              <td class="hidden-cols dim">…</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if overflowCount > 0}
      <div class="overflow">+ {overflowCount} more rows (showing first 500)</div>
    {/if}
  {/if}
</div>

<style>
  .dt { overflow: auto; height: 100%; font-family: var(--font-mono); font-size: 11.5px; display: flex; flex-direction: column; }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px var(--space-3);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    min-height: 22px;
    position: relative;
  }
  .toolbar-meta { color: var(--fg-dim); }
  .hidden-note { color: var(--accent); }
  .columns-wrap { position: relative; }
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

  table { border-collapse: collapse; width: 100%; table-layout: auto; }
  th, td {
    border-bottom: 1px solid var(--border);
    padding: 3px 8px;
    text-align: left;
    vertical-align: top;
    position: relative;
  }
  th {
    background: var(--bg-panel);
    color: var(--fg-dim);
    font-weight: normal;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    z-index: 1;
    padding-right: 22px; /* leave room for ⋮ and resize handle */
    user-select: none;
  }
  th.kind-synthetic .col-name { font-style: italic; }
  th.hidden-cols { color: var(--fg-dim); }
  th.sorted { color: var(--fg); }
  .header-label {
    font: inherit;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    letter-spacing: inherit;
    text-transform: inherit;
    text-align: left;
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .header-label:disabled { cursor: default; }
  th.sortable .header-label:hover { color: var(--fg); }
  .sort-arrow { color: var(--accent); }
  .menu-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
    opacity: 0;
  }
  th:hover .menu-btn { opacity: 1; }
  .menu-btn:hover { color: var(--accent); }
  .resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    background: transparent;
    border: none;
    padding: 0;
  }
  th:hover .resize-handle { background: var(--border); }
  .resize-handle:hover { background: var(--accent) !important; }

  td { color: var(--fg); user-select: text; }
  td.hidden-cols { color: var(--fg-dim); }
  .dim { color: var(--fg-dim); }
  .cell-text { user-select: text; }
  .chip {
    font: inherit;
    background: var(--bg-panel);
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 0 6px;
    cursor: pointer;
    font-size: 11px;
  }
  .chip:hover { color: var(--accent); border-color: var(--accent); }
  .more {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: 11px;
  }
  .more:hover { color: var(--accent); }
  .copy-btn {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: 11px;
    margin-left: 4px;
    opacity: 0;
    vertical-align: baseline;
  }
  td:hover .copy-btn { opacity: 1; }
  .copy-btn:hover { color: var(--accent); }

  /* Dropdown menus */
  .header-menu, .columns-menu {
    position: absolute;
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    z-index: 10;
    min-width: 170px;
    font-size: 11px;
    text-transform: none;
    letter-spacing: normal;
  }
  .header-menu {
    top: 100%;
    right: 0;
  }
  .columns-menu {
    top: 100%;
    right: 0;
    min-width: 200px;
    max-height: 320px;
    overflow-y: auto;
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
  .menu-label {
    padding: 4px 12px;
    color: var(--fg-dim);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2px 0;
  }

  .empty {
    color: var(--fg-dim);
    padding: var(--space-4);
    text-align: center;
    font-size: 12px;
  }
  .overflow {
    padding: var(--space-2) var(--space-3);
    color: var(--fg-dim);
    font-size: 11px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }
</style>
