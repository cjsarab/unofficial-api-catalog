<script lang="ts">
  import type { DecomposedTable } from "./types.ts";

  type Props = {
    tables: DecomposedTable[];
    activePath: string;
    onSelect: (path: string) => void;
  };
  let { tables, activePath, onSelect }: Props = $props();

  const MAX_RAIL = 50;
  const MAX_INDENT_DEPTH = 5;

  let filter = $state("");
  let collapsed = $state<Set<string>>(new Set());

  function toggleCollapse(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function hasChildren(path: string): boolean {
    return tables.some((t) => t.parentPath === path);
  }

  function isHiddenByCollapsedAncestor(table: DecomposedTable): boolean {
    let p = table.parentPath;
    while (p) {
      if (collapsed.has(p)) return true;
      const parent = tables.find((t) => t.path === p);
      p = parent ? parent.parentPath : null;
    }
    return false;
  }

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return tables.filter((t) => {
      if (isHiddenByCollapsedAncestor(t)) return false;
      if (!q) return true;
      return t.path.toLowerCase().includes(q) || t.label.toLowerCase().includes(q);
    });
  });

  const visible = $derived(filtered.slice(0, MAX_RAIL));
  const hiddenCount = $derived(filtered.length - visible.length);
</script>

<aside class="rail">
  {#if tables.length > MAX_RAIL}
    <div class="filter">
      <input
        type="text"
        placeholder="Filter paths…"
        bind:value={filter}
        aria-label="Filter tables"
      />
    </div>
  {/if}
  <div class="items">
    {#each visible as t}
      <div
        class="item depth-{Math.min(t.depth, MAX_INDENT_DEPTH)}"
        class:active={t.path === activePath}
        onclick={() => onSelect(t.path)}
        onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(t.path); }}
        role="button"
        tabindex="0"
      >
        {#if hasChildren(t.path)}
          <button
            class="caret"
            aria-label={collapsed.has(t.path) ? "expand" : "collapse"}
            onclick={(e) => { e.stopPropagation(); toggleCollapse(t.path); }}
          >{collapsed.has(t.path) ? "▸" : "▾"}</button>
        {:else}
          <span class="caret empty">·</span>
        {/if}
        <div class="body">
          <div class="label">{t.label}</div>
          <div class="meta">{t.rows.length}·{t.columns.length}</div>
          {#if t.depth >= MAX_INDENT_DEPTH}
            <div class="path">{t.path}</div>
          {/if}
        </div>
      </div>
    {/each}
    {#if hiddenCount > 0}
      <div class="overflow">… {hiddenCount} more — filter to find</div>
    {/if}
  </div>
</aside>

<style>
  .rail {
    min-width: 240px;
    max-width: 480px;
    width: 280px;
    resize: horizontal;
    overflow: auto;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    display: flex;
    flex-direction: column;
  }
  .filter {
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    position: sticky;
    top: 0;
  }
  .filter input {
    width: 100%;
    font: inherit;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 3px var(--space-1-5);
  }
  .items { padding: var(--space-1) 0; }
  .item {
    display: flex;
    align-items: flex-start;
    padding: 3px var(--space-1-5);
    cursor: pointer;
    border-left: 2px solid transparent;
    color: var(--fg-dim);
    gap: var(--space-1);
  }
  .item:hover { background: var(--bg-raised); }
  .item.active {
    background: var(--bg);
    color: var(--fg);
    border-left-color: var(--accent);
  }
  .item.depth-0 { padding-left: var(--space-1); }
  .item.depth-1 { padding-left: var(--space-5); }
  .item.depth-2 { padding-left: 36px; }
  .item.depth-3 { padding-left: 52px; }
  .item.depth-4 { padding-left: 68px; }
  .item.depth-5 { padding-left: 84px; }
  .caret {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    padding: 0;
    width: 12px;
    flex-shrink: 0;
    cursor: pointer;
    text-align: center;
  }
  .caret.empty { cursor: default; }
  .body { flex: 1; min-width: 0; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--fg-dim); font-size: var(--fs-xs); opacity: 0.8; }
  .path {
    color: var(--fg-dim);
    font-size: var(--fs-xs);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .overflow {
    color: var(--fg-dim);
    padding: var(--space-1) var(--space-3);
    font-size: 10.5px;
  }
</style>
