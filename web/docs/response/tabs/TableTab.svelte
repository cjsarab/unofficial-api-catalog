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

  const tables = $derived<DecomposedTable[]>(json === null ? [] : decompose(json));
  let selectedPath = $state<string>("");

  $effect(() => {
    // Whenever the table list changes, pick a sane default selection.
    if (tables.length === 0) return;
    if (!tables.find((t) => t.path === selectedPath)) {
      selectedPath = tables[0].path;
    }
  });

  const selectedTable = $derived<DecomposedTable | null>(
    tables.find((t) => t.path === selectedPath) ?? null,
  );

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
</script>

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
    <div class="layout" class:single={tables.length <= 1}>
      {#if tables.length > 1}
        <TableRail
          tables={tables}
          activePath={selectedPath}
          onSelect={(p) => (selectedPath = p)}
        />
      {/if}
      <div class="content">
        {#if selectedTable}
          <div class="crumbs">
            <span class="path-label">
              {#if breadcrumbs.length > 1}
                {#each breadcrumbs as crumb, i}
                  {#if i > 0}<span class="sep"> / </span>{/if}
                  {#if i < breadcrumbs.length - 1}
                    <a onclick={() => (selectedPath = crumb.path)} role="button" tabindex="0">{crumb.label}</a>
                  {:else}
                    <strong>{crumb.label}</strong>
                  {/if}
                {/each}
              {:else}
                <strong>{selectedTable.label}</strong>
              {/if}
            </span>
            <span class="meta">
              {selectedTable.rows.length} rows · {selectedTable.columns.length} cols
              {#if selectedTable.rangeNote}&nbsp;· heterogeneous run {selectedTable.rangeNote}{/if}
            </span>
          </div>
          <DataTable
            table={selectedTable}
            onNavigate={(p) => (selectedPath = p)}
            onJumpToRaw={onJumpToRaw}
          />
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .table-tab { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .layout { display: flex; flex: 1; min-height: 0; }
  .layout.single { display: block; }
  .content { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .crumbs {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
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
</style>
