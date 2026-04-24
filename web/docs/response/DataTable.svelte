<script lang="ts">
  import type { DecomposedTable, CellValue, Column } from "./types.ts";

  type Props = {
    table: DecomposedTable;
    /** Called when a count-link cell is clicked. */
    onNavigate?: (targetPath: string) => void;
    /** Called when a chip cell is clicked (jump to Raw). */
    onJumpToRaw?: (jumpPath: string) => void;
  };
  let { table, onNavigate, onJumpToRaw }: Props = $props();

  const STRING_TRUNCATE = 80;

  let expandedCells = $state<Set<string>>(new Set());

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

  const visibleRows = $derived.by(() => {
    // Simple ceiling for v1 — cap at 500 rows rendered, show a footer note for the rest.
    // Full virtualisation can come later if users hit the cap routinely.
    return table.rows.slice(0, 500);
  });

  const overflowCount = $derived(Math.max(0, table.rows.length - visibleRows.length));
</script>

<div class="dt">
  {#if table.columns.length === 0}
    <div class="empty">
      {table.rows.length === 0 ? "Empty — 0 rows, 0 columns" : `${table.rows.length} rows · 0 columns`}
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          {#each table.columns as col}
            <th title={col.synthNote ?? ""} class="kind-{col.kind}">{col.key}</th>
          {/each}
          {#if table.hiddenColumnCount}
            <th class="hidden-cols">+{table.hiddenColumnCount} more</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each visibleRows as row, rowIdx}
          <tr>
            {#each table.columns as col}
              {@const cell = row[col.key] as CellValue | undefined}
              <td>
                {#if cell === undefined}
                  <span class="dim">—</span>
                {:else if cell.kind === "scalar"}
                  {@const text = renderScalar(cell.value)}
                  {@const t = truncatedScalar(text)}
                  {#if cell.value === null}
                    <span class="dim">null</span>
                  {:else if t.truncated && !expandedCells.has(cellKey(rowIdx, col.key))}
                    <span title={text}>{t.display}</span>
                    <button class="more" onclick={() => toggleExpand(cellKey(rowIdx, col.key))}>+</button>
                  {:else if t.truncated}
                    <span>{text}</span>
                    <button class="more" onclick={() => toggleExpand(cellKey(rowIdx, col.key))}>−</button>
                  {:else}
                    <span>{text}</span>
                  {/if}
                {:else if cell.kind === "chip-array"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>[{cell.count}]</button>
                {:else if cell.kind === "chip-object"}
                  <button class="chip" onclick={() => onJumpToRaw?.(cell.jumpPath)}>{`{${cell.keyCount}}`}</button>
                {:else if cell.kind === "count-link"}
                  <button class="chip" onclick={() => onNavigate?.(cell.targetTablePath)}>→ {cell.count} {cell.count === 1 ? "row" : "rows"}</button>
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
  .dt { overflow: auto; height: 100%; font-family: var(--font-mono); font-size: 11.5px; }
  table { border-collapse: collapse; width: 100%; }
  th, td {
    border-bottom: 1px solid var(--border);
    padding: 3px 8px;
    text-align: left;
    vertical-align: top;
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
  }
  th.kind-synthetic { font-style: italic; }
  th.hidden-cols { color: var(--fg-dim); }
  td { color: var(--fg); }
  td.hidden-cols { color: var(--fg-dim); }
  .dim { color: var(--fg-dim); }
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
