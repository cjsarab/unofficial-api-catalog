<script lang="ts">
  import type { DecomposedTable, CellValue, Column } from "./types.ts";
  import { compareCells } from "./compare.ts";

  type Props = {
    table: DecomposedTable;
    /** Hidden-column set, owned by the parent (TableTab). */
    hiddenCols: Set<string>;
    /** Called when a per-header menu item toggles a column's hidden state. */
    onToggleHidden: (colKey: string) => void;
    /** Called when a count-link cell is clicked. */
    onNavigate?: (targetPath: string, parentRowId?: string | number) => void;
    /** Called when a chip cell is clicked (jump to Raw). */
    onJumpToRaw?: (jumpPath: string) => void;
  };
  let { table, hiddenCols, onToggleHidden, onNavigate, onJumpToRaw }: Props = $props();

  const STRING_TRUNCATE = 80;
  const MIN_COL_WIDTH = 60;
  const MENU_WIDTH = 200;

  // ───────────────────────── state ─────────────────────────

  let expandedCells = $state<Set<string>>(new Set());
  let copiedCell = $state<string | null>(null);

  // Per-component feature state — resets when the user navigates to a different table.
  let sort = $state<{ col: string; dir: "asc" | "desc" } | null>(null);
  let colWidths = $state<Map<string, number>>(new Map());

  // Menu-open state — kept OUT of the reset effect so opening a menu doesn't
  // re-trigger the reset on its own state change.
  let openHeaderMenu = $state<string | null>(null); // column key whose ⋮ dropdown is open
  let menuAnchorRect = $state<DOMRect | null>(null);

  $effect(() => {
    // Track table.path; when it changes, reset feature state.
    // hiddenCols is reset by the parent (TableTab) in its own effect.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = table.path;
    sort = null;
    colWidths = new Map();
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

  // Position-fixed anchor math for the ⋮ dropdown.
  const menuLeft = $derived.by(() => {
    if (!menuAnchorRect) return 0;
    return menuAnchorRect.right + MENU_WIDTH > window.innerWidth
      ? Math.max(8, menuAnchorRect.right - MENU_WIDTH)
      : menuAnchorRect.left;
  });
  const menuTop = $derived(menuAnchorRect ? menuAnchorRect.bottom + 4 : 0);

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

  // ───────────────────── menu open / close ─────────────────────

  function openMenuFor(colKey: string, e: MouseEvent) {
    e.stopPropagation();
    if (openHeaderMenu === colKey) {
      openHeaderMenu = null;
      menuAnchorRect = null;
      return;
    }
    menuAnchorRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openHeaderMenu = colKey;
  }

  function closeMenu() {
    openHeaderMenu = null;
    menuAnchorRect = null;
  }

  // ───────────────────── close-on-outside-click ─────────────────────

  function onWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (openHeaderMenu !== null && !target.closest(".header-menu, .menu-btn")) {
      closeMenu();
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && openHeaderMenu !== null) {
      closeMenu();
    }
  }

  // Close the menu on scroll/resize — repositioning would be cheap, but users
  // don't expect a menu to survive a scroll either. Simplest correct answer.
  function onWindowScrollOrResize() {
    if (openHeaderMenu !== null) closeMenu();
  }

  // ───────────────────── menu helpers ─────────────────────

  function widthStyle(colKey: string): string {
    const w = colWidths.get(colKey);
    return w ? `width:${w}px;min-width:${w}px;max-width:${w}px;` : "";
  }
</script>

<svelte:window
  onclick={onWindowClick}
  onkeydown={onWindowKey}
  onscroll={onWindowScrollOrResize}
  onresize={onWindowScrollOrResize}
/>

<div class="dt">
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
                onclick={(e) => openMenuFor(col.key, e)}
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

{#if openHeaderMenu !== null && menuAnchorRect}
  {@const col = table.columns.find((c) => c.key === openHeaderMenu)}
  {#if col}
    {@const sortable = isColumnSortable(col)}
    <div
      class="header-menu"
      role="menu"
      style="top:{menuTop}px; left:{menuLeft}px;"
    >
      <button
        class="menu-item"
        disabled={!sortable || (!!sort && sort.col === col.key && sort.dir === "asc")}
        onclick={() => { setSort(col.key, "asc"); closeMenu(); }}
      >Sort ascending ▲</button>
      <button
        class="menu-item"
        disabled={!sortable || (!!sort && sort.col === col.key && sort.dir === "desc")}
        onclick={() => { setSort(col.key, "desc"); closeMenu(); }}
      >Sort descending ▼</button>
      <button
        class="menu-item"
        disabled={!sort || sort.col !== col.key}
        onclick={() => { clearSort(); closeMenu(); }}
      >Clear sort</button>
      <hr />
      <button class="menu-item" onclick={() => { onToggleHidden(col.key); closeMenu(); }}>Hide column</button>
      <button class="menu-item" onclick={() => { copyText(col.key, `col:${col.key}`); closeMenu(); }}>Copy column name</button>
    </div>
  {/if}
{/if}

<style>
  .dt { overflow: auto; height: 100%; font-family: var(--font-mono); font-size: 11.5px; display: flex; flex-direction: column; }

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

  /* Dropdown menu — rendered at the top level with position:fixed so it
     escapes the .dt overflow/stacking context even on narrow columns. */
  .header-menu {
    position: fixed;
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    z-index: 100;
    min-width: 200px;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: none;
    letter-spacing: normal;
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
