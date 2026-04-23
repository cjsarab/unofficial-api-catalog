<script lang="ts">
  type Summary = {
    apiCount: number;
    endpointCount: number;
    columnCount: number;
    distinctColumnCount: number;
    lineageEdgeCount: number;
    families: Array<{ family: string; c: number }>;
  };

  type Props = {
    summary: Summary | null;
    catalogPath: string | undefined;
    env: string;
    lastResponse?: { status: number; durationMs: number } | null;
  };
  let { summary, catalogPath, env, lastResponse }: Props = $props();

  const fmt = (n: number) => n.toLocaleString("en-US");

  function shortPath(p: string | undefined) {
    if (!p) return "no catalog";
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 3) return p;
    // parts[0] is already "C:" (including the colon) because split keeps it.
    // Joining with "\\…\\" gives the expected "C:\…\foo\bar".
    return parts[0] + "\\…\\" + parts.slice(-2).join("\\");
  }
</script>

<footer class="status-bar">
  <div class="left">
    {#if summary}
      <span>indexed {fmt(summary.apiCount)}</span>
      <span class="sep">·</span>
      <span>{summary.families.length}/20 families</span>
      <span class="sep">·</span>
      <span title={catalogPath}>catalog @ {shortPath(catalogPath)}</span>
    {:else}
      <span>no index loaded</span>
    {/if}
  </div>
  <div class="right">
    <span class="env">env: {env}</span>
    {#if lastResponse}
      <span class="sep">·</span>
      <span class="status-code" class:ok={lastResponse.status < 400} class:err={lastResponse.status >= 400}>
        last {lastResponse.status} · {lastResponse.durationMs}ms
      </span>
    {/if}
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--fg-dim);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
  }
  .left, .right { display: flex; gap: 6px; align-items: center; }
  .sep { opacity: 0.5; }
  .env { color: var(--fg); }
  .status-code.ok { color: var(--fg-bright); }
  .status-code.err { color: var(--danger); }
</style>
