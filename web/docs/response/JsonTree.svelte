<script lang="ts">
  import type { Json } from "./types.ts";
  import JsonTree from "./JsonTree.svelte";
  import { untrack } from "svelte";

  type Props = {
    value: Json;
    /** Key name when this node is an object entry. Omitted for array elements and root. */
    name?: string;
    /** Depth in the tree — drives default-expanded state + indent. */
    depth?: number;
    /** Nodes whose depth >= this value start collapsed. Root passes 2. */
    defaultExpandedMax?: number;
  };
  let { value, name, depth = 0, defaultExpandedMax = 2 }: Props = $props();

  // Initial expansion state depends only on initial depth; $state initializer runs once.
  // Wrap the props read in `untrack` so Svelte doesn't warn about capturing only the
  // initial value (capturing-once is exactly what we want here).
  let expanded = $state(untrack(() => depth < defaultExpandedMax));

  type Kind = "null" | "bool" | "number" | "string" | "array" | "object";
  const kind: Kind = $derived.by(() => {
    if (value === null) return "null";
    if (typeof value === "boolean") return "bool";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    if (Array.isArray(value)) return "array";
    return "object";
  });

  const childCount = $derived(
    kind === "array" ? (value as Json[]).length :
    kind === "object" ? Object.keys(value as { [k: string]: Json }).length :
    0,
  );
  const canExpand = $derived((kind === "object" || kind === "array") && childCount > 0);
</script>

<div class="node" style="padding-left: {depth === 0 ? '0' : 'var(--space-3)'}">
  {#if canExpand}
    <button class="chev" onclick={() => (expanded = !expanded)} aria-label={expanded ? "collapse" : "expand"}>
      {expanded ? "▾" : "▸"}
    </button>
  {:else}
    <span class="chev empty">&nbsp;</span>
  {/if}

  {#if name !== undefined}
    <span class="tk-key">"{name}"</span><span class="tk-punct">: </span>
  {/if}

  {#if kind === "null"}
    <span class="tk-null">null</span>
  {:else if kind === "bool"}
    <span class="tk-bool">{String(value)}</span>
  {:else if kind === "number"}
    <span class="tk-number">{value}</span>
  {:else if kind === "string"}
    <span class="tk-string">"{value}"</span>
  {:else if kind === "array"}
    {#if childCount === 0}
      <span class="tk-punct">[]</span>
    {:else if !expanded}
      <span class="tk-punct">[</span><span class="summary"> … {childCount} {childCount === 1 ? "item" : "items"} </span><span class="tk-punct">]</span>
    {:else}
      <span class="tk-punct">[</span>
      {#each (value as Json[]) as child}
        <JsonTree value={child} depth={depth + 1} defaultExpandedMax={defaultExpandedMax} />
      {/each}
      <span class="tk-punct close">]</span>
    {/if}
  {:else}
    {#if childCount === 0}
      <span class="tk-punct">{"{}"}</span>
    {:else if !expanded}
      <span class="tk-punct">{"{"}</span><span class="summary"> … {childCount} {childCount === 1 ? "key" : "keys"} </span><span class="tk-punct">{"}"}</span>
    {:else}
      <span class="tk-punct">{"{"}</span>
      {#each Object.entries(value as { [k: string]: Json }) as [k, v]}
        <JsonTree name={k} value={v} depth={depth + 1} defaultExpandedMax={defaultExpandedMax} />
      {/each}
      <span class="tk-punct close">{"}"}</span>
    {/if}
  {/if}
</div>

<style>
  .node {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.4;
  }
  .chev {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    width: 14px;
    text-align: center;
    padding: 0;
    cursor: pointer;
  }
  .chev:hover { color: var(--accent); }
  .chev.empty { cursor: default; }
  .summary {
    color: var(--fg-dim);
    font-style: italic;
  }
  .close {
    margin-left: -1ch;  /* close brace aligns with its opener's column, not its children */
  }
  /* tk-* classes come from the global styles in RawTab; re-declare for isolation: */
  :global(.node .tk-key)    { color: var(--accent); }
  :global(.node .tk-string) { color: var(--fg); }
  :global(.node .tk-number) { color: color-mix(in srgb, var(--accent) 60%, var(--fg) 40%); }
  :global(.node .tk-bool)   { color: color-mix(in srgb, var(--accent) 50%, var(--fg) 50%); }
  :global(.node .tk-null)   { color: var(--fg-dim); }
  :global(.node .tk-punct)  { color: var(--fg-dim); }
</style>
