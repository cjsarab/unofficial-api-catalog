<script lang="ts">
  type Summary = {
    apiCount: number;
    endpointCount: number;
    columnCount: number;
    distinctColumnCount: number;
    lineageEdgeCount: number;
    families: Array<{ family: string; c: number }>;
    domains: Array<{ source_domain: string | null; c: number }>;
    errors: number;
  };
  type TopColumn = { column_name: string; api_count: number; total_occurrences: number };
  type TopTable = { table: string; api_count: number };

  type LastScanStatus = "running" | "complete" | "aborted" | "error";
  type LastScan = {
    status: LastScanStatus | null;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
  };

  type Props = {
    onSelectColumn: (name: string) => void;
    onSelectTable: (name: string) => void;
    /** App owns the summary fetch + re-fetch on rescan; we just render it.
     *  Previously this component fetched independently, causing two requests
     *  per overview render and stale stats after a rescan. */
    summary: Summary | null;
    lastScan?: LastScan | null;
    rescanInFlight?: boolean;
    onRescan?: () => void;
  };
  let {
    onSelectColumn,
    onSelectTable,
    summary,
    lastScan = null,
    rescanInFlight = false,
    onRescan,
  }: Props = $props();

  const incomplete = $derived(
    !!lastScan && (lastScan.status === "aborted" || lastScan.status === "error"),
  );

  let topColumns = $state<TopColumn[]>([]);
  let topTables = $state<TopTable[]>([]);

  const fmt = (n: number) => n.toLocaleString("en-US");

  // Top-N lists are still loaded here — they're overview-specific (not part of
  // the App-level summary) and small enough to refetch when the user revisits.
  // Refire when summary changes (e.g. after a rescan) so top-tables/top-columns
  // also refresh and don't go stale.
  $effect(() => {
    void summary;
    (async () => {
      const [colsRes, tablesRes] = await Promise.all([
        fetch("/api/columns?limit=12"),
        fetch("/api/tables?limit=12"),
      ]);
      if (colsRes.ok) topColumns = ((await colsRes.json()) as { columns: TopColumn[] }).columns;
      if (tablesRes.ok) topTables = ((await tablesRes.json()) as { tables: TopTable[] }).tables;
    })();
  });
</script>

<div class="overview">
  <header>
    <div class="label">catalog overview</div>
    <h1>Select an API from the tree, or start with one of these.</h1>
    <p class="dim">Use the family tree, column dictionary, or table list on the left. Any column or table below also jumps to its profile.</p>
  </header>

  {#if incomplete}
    <div class="incomplete-banner" role="status">
      <div class="text">
        <strong>Indexing was interrupted.</strong>
        The numbers below may be incomplete{#if lastScan?.error} ({lastScan.error}){/if}.
      </div>
      <button class="rescan" onclick={() => onRescan?.()} disabled={rescanInFlight || !onRescan}>
        {rescanInFlight ? "Rescanning…" : "Re-scan"}
      </button>
    </div>
  {/if}

  {#if summary}
    <section class="stats">
      <dl>
        <div class="stat"><dt>APIs</dt><dd>{fmt(summary.apiCount)}</dd></div>
        <div class="stat"><dt>Endpoints</dt><dd>{fmt(summary.endpointCount)}</dd></div>
        <div class="stat"><dt>Distinct columns</dt><dd>{fmt(summary.distinctColumnCount)}</dd></div>
        <div class="stat"><dt>Column refs</dt><dd>{fmt(summary.columnCount)}</dd></div>
        <div class="stat"><dt>Lineage edges</dt><dd>{fmt(summary.lineageEdgeCount)}</dd></div>
        <div class="stat"><dt>Parse errors</dt><dd class:ok={summary.errors === 0}>{fmt(summary.errors)}</dd></div>
      </dl>
    </section>

    <div class="split">
      <section>
        <h2>Families</h2>
        <ul class="family-list">
          {#each summary.families.slice(0, 12) as f}
            <li><span>{f.family}</span><span class="count">{fmt(f.c)}</span></li>
          {/each}
        </ul>
      </section>

      <section>
        <h2>Top tables</h2>
        <ul class="list">
          {#each topTables as t}
            <li>
              <button class="link-btn" onclick={() => onSelectTable(t.table)}>{t.table}</button>
              <span class="count">{fmt(t.api_count)} APIs</span>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <section>
      <h2>Top columns</h2>
      <ul class="list two-col">
        {#each topColumns as c}
          <li>
            <button class="link-btn" onclick={() => onSelectColumn(c.column_name)}>{c.column_name}</button>
            <span class="count">{fmt(c.api_count)} APIs · {fmt(c.total_occurrences)} refs</span>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <section><p class="dim">Loading index…</p></section>
  {/if}
</div>

<style>
  .overview {
    padding: var(--space-5) var(--space-6);
    max-width: 1200px;
    margin: 0 auto;
  }
  header { margin-bottom: var(--space-5); }
  .label {
    color: var(--fg-dim);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1 {
    color: var(--accent);
    margin: 4px 0;
    font-size: 18px;
    letter-spacing: 0.02em;
  }
  h2 {
    color: var(--fg-bright);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: var(--space-5) 0 var(--space-2);
    border-bottom: 1px dotted var(--border);
    padding-bottom: 4px;
  }
  p.dim { color: var(--fg-dim); font-size: 12px; margin: var(--space-2) 0; }

  section.stats dl {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: var(--space-3);
    margin: 0;
  }
  .stat {
    border: 1px solid var(--border);
    padding: var(--space-3);
    background: var(--bg-panel);
  }
  .stat dt {
    color: var(--fg-dim);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .stat dd {
    color: var(--fg-bright);
    font-size: 18px;
    font-variant-numeric: tabular-nums;
    margin: 3px 0 0;
  }
  .stat dd.ok { color: var(--fg); }

  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6);
  }

  ul.list, ul.family-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  ul.list.two-col {
    grid-template-columns: repeat(2, 1fr);
    gap: 2px var(--space-6);
  }
  ul.family-list li,
  ul.list li {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px dotted var(--border);
  }
  .count {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
  }
  a {
    color: var(--fg-bright);
    text-decoration: none;
    border-bottom: 1px dotted var(--border-strong);
  }
  a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  button.link-btn {
    font: inherit;
    font-family: var(--font-mono);
    background: transparent;
    color: var(--fg-bright);
    border: none;
    border-bottom: 1px dotted var(--border-strong);
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  button.link-btn:hover { color: var(--accent); border-bottom-color: var(--accent); }

  @media (max-width: 1100px) {
    section.stats dl { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 800px) {
    .split { grid-template-columns: 1fr; }
    ul.list.two-col { grid-template-columns: 1fr; }
  }

  .incomplete-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    border: 1px solid var(--warn);
    border-left-width: 3px;
    background: var(--bg-panel);
    color: var(--fg);
    padding: var(--space-3) var(--space-4);
    margin: 0 0 var(--space-4);
    font-size: 12px;
  }
  .incomplete-banner strong { color: var(--warn); margin-right: 6px; }
  .incomplete-banner .rescan {
    font: inherit;
    font-family: var(--font-mono);
    background: transparent;
    border: 1px solid var(--warn);
    color: var(--warn);
    padding: 4px 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .incomplete-banner .rescan:hover:not(:disabled) {
    background: var(--warn);
    color: var(--bg);
  }
  .incomplete-banner .rescan:disabled { cursor: progress; opacity: 0.7; }
</style>
