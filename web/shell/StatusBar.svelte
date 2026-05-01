<script lang="ts">
  type Summary = {
    apiCount: number;
    endpointCount: number;
    columnCount: number;
    distinctColumnCount: number;
    lineageEdgeCount: number;
    families: Array<{ family: string; c: number }>;
  };

  type LastScanStatus = "running" | "complete" | "aborted" | "error";
  type LastScan = {
    status: LastScanStatus | null;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
  };

  type Props = {
    summary: Summary | null;
    catalogPath: string | undefined;
    env: string;
    lastResponse?: { status: number; durationMs: number } | null;
    lastScan?: LastScan | null;
    rescanInFlight?: boolean;
    onRescan?: () => void;
  };
  let {
    summary,
    catalogPath,
    env,
    lastResponse,
    lastScan = null,
    rescanInFlight = false,
    onRescan,
  }: Props = $props();

  const fmt = (n: number) => n.toLocaleString("en-US");

  function shortPath(p: string | undefined) {
    if (!p) return "no catalog";
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 3) return p;
    // parts[0] is already "C:" (including the colon) because split keeps it.
    // Joining with "\\…\\" gives the expected "C:\…\foo\bar".
    return parts[0] + "\\…\\" + parts.slice(-2).join("\\");
  }

  const incomplete = $derived(
    !!lastScan && (lastScan.status === "aborted" || lastScan.status === "error"),
  );
</script>

<footer class="status-bar">
  <div class="left">
    {#if summary}
      <span>indexed {fmt(summary.apiCount)}</span>
      <span class="sep">·</span>
      <span>{summary.families.length}/20 families</span>
      <span class="sep">·</span>
      <span title={catalogPath}>catalog @ {shortPath(catalogPath)}</span>
      {#if incomplete}
        <span class="sep">·</span>
        <button
          class="incomplete-chip"
          onclick={() => onRescan?.()}
          disabled={rescanInFlight || !onRescan}
          title={lastScan?.error || "the previous scan was interrupted; the index may be partial"}
        >
          ◇ index incomplete{rescanInFlight ? " · rescanning…" : " · re-scan"}
        </button>
      {/if}
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
    padding: 3px var(--space-2-5);
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--fg-dim);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
  }
  .left, .right { display: flex; gap: var(--space-1-5); align-items: center; }
  .sep { opacity: 0.5; }
  .env { color: var(--fg); }
  .status-code.ok { color: var(--fg-bright); }
  .status-code.err { color: var(--danger); }

  .incomplete-chip {
    font: inherit;
    font-family: var(--font-mono);
    background: transparent;
    border: 1px solid var(--warn);
    color: var(--warn);
    padding: 1px var(--space-1-5);
    border-radius: 2px;
    cursor: pointer;
    line-height: 1.3;
  }
  .incomplete-chip:hover:not(:disabled) {
    background: var(--warn);
    color: var(--bg);
  }
  .incomplete-chip:disabled {
    cursor: progress;
    opacity: 0.7;
  }
</style>
