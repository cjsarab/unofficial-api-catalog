<script lang="ts">
  type Props = {
    title: string;
    count?: number | string;
    expanded: boolean;
    onToggle: () => void;
  };
  let { title, count, expanded, onToggle }: Props = $props();
</script>

<button class="header" class:expanded onclick={onToggle} aria-expanded={expanded}>
  <span class="chevron">{expanded ? "▾" : "▸"}</span>
  <span class="title">{title}</span>
  {#if count !== undefined}
    <span class="count">{count}</span>
  {/if}
</button>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    font: inherit;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-dim);
    background: var(--bg-raised);
    border: none;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 5px 10px;
    cursor: pointer;
    text-align: left;
  }
  .header:hover { color: var(--fg); }
  .header.expanded { color: var(--fg-bright); }
  .chevron {
    width: 10px;
    text-align: center;
    font-size: 9px;
    opacity: 0.8;
  }
  .title { flex: 1; }
  .count {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    letter-spacing: 0;
  }
</style>
