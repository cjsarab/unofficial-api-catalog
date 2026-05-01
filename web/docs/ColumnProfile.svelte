<script lang="ts">
  type ApiRow = {
    api_id: number;
    family: string;
    resource: string;
    version: string;
    title: string | null;
    source_system: string | null;
    source_domain: string | null;
    release_status: string | null;
    api_type: string | null;
    table_name: string | null;
    field_path: string;
    raw_expression: string;
  };
  type CountRow<K extends string> = { [k in K]: string | null } & { c: number };
  type Profile = {
    column: string;
    occurrences: number;
    distinctApis: number;
    inferredTable?: string;
    apis: ApiRow[];
    atAGlance: {
      byFamily: CountRow<"family">[];
      bySourceSystem: CountRow<"source_system">[];
      byDomain: CountRow<"source_domain">[];
      byStatus: CountRow<"release_status">[];
    };
    otherColumnsOnTable: { column_name: string; api_count: number }[];
    cooccursWith: { column_name: string; shared_apis: number }[];
  };

  type Props = {
    name: string;
    onSelectColumn: (name: string) => void;
    onSelectTable: (name: string) => void;
    onSelectApi: (family: string, resource: string, version?: string) => void;
  };
  let { name, onSelectColumn, onSelectTable, onSelectApi }: Props = $props();

  let data = $state<Profile | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let inflight: AbortController | undefined;

  // Filters
  let fFamily = $state<string>("");
  let fStatus = $state<string>("");
  let fDomain = $state<string>("");

  $effect(() => {
    load(name);
  });

  async function load(col: string) {
    inflight?.abort();
    const my = new AbortController();
    inflight = my;
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/columns/${encodeURIComponent(col)}`, { signal: my.signal });
      if (my.signal.aborted) return;
      if (!res.ok) {
        error = `server responded ${res.status}`;
        return;
      }
      const body = (await res.json()) as Profile;
      if (my.signal.aborted) return;
      data = body;
    } catch (err) {
      if ((err as Error).name === "AbortError" || my.signal.aborted) return;
      error = (err as Error).message;
    } finally {
      if (!my.signal.aborted) loading = false;
    }
  }

  const filtered = $derived.by((): ApiRow[] => {
    if (!data) return [];
    return data.apis.filter(
      (a) =>
        (!fFamily || a.family === fFamily) &&
        (!fStatus || a.release_status === fStatus) &&
        (!fDomain || a.source_domain === fDomain),
    );
  });

  // Split expression into text/column/table spans (same pattern as ApiDocsView)
  const TOKEN_RE = /[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+/g;
  function splitExpr(raw: string, tableNames: Set<string>) {
    const parts: { kind: "text" | "column" | "table"; text: string }[] = [];
    let lastIndex = 0;
    for (const m of raw.matchAll(TOKEN_RE)) {
      const idx = m.index ?? 0;
      if (idx > lastIndex) parts.push({ kind: "text", text: raw.slice(lastIndex, idx) });
      const token = m[0];
      parts.push({ kind: tableNames.has(token) ? "table" : "column", text: token });
      lastIndex = idx + token.length;
    }
    if (lastIndex < raw.length) parts.push({ kind: "text", text: raw.slice(lastIndex) });
    return parts;
  }

  const tableNames = $derived.by((): Set<string> => {
    if (!data) return new Set();
    const s = new Set<string>();
    for (const a of data.apis) if (a.table_name) s.add(a.table_name);
    if (data.inferredTable) s.add(data.inferredTable);
    return s;
  });

  const fmt = (n: number) => n.toLocaleString("en-US");

  function prettyFieldPath(raw: string): string {
    let p = raw;
    const pathsMatch = p.match(/^paths\.([^.]+)\.(get|post|put|patch|delete|options|head|trace)(\..+)?$/i);
    if (pathsMatch) {
      const [, path, method, rest] = pathsMatch;
      const cleaned = (rest ?? "")
        .replace(/^\.responses\.\d+\.content\.[^.]+\.schema\./, "response.")
        .replace(/^\.requestBody\.content\.[^.]+\.schema\./, "body.")
        .replace(/^\.parameters\.\[(\d+)\]$/, " · param[$1]")
        .replace(/\.properties\./g, ".")
        .replace(/\.items\./g, "[].")
        .replace(/\.oneOf\.\[(\d+)\]\./g, ".variant$1.");
      return `${method!.toUpperCase()} ${path}${cleaned}`;
    }
    p = p.replace(/^components\.schemas\.[^.]+\.?/, "");
    p = p.replace(/^properties\./, "");
    p = p.replace(/\.properties\./g, ".");
    p = p.replace(/\.items\./g, "[].");
    p = p.replace(/\.oneOf\.\[(\d+)\]\./g, ".variant$1.");
    return p || "(root)";
  }

  const uniqueFamilies = $derived(
    data ? Array.from(new Set(data.apis.map((a) => a.family))).sort() : [],
  );
  const uniqueStatuses = $derived(
    data
      ? Array.from(new Set(data.apis.map((a) => a.release_status).filter(Boolean))).sort() as string[]
      : [],
  );
  const uniqueDomains = $derived(
    data
      ? Array.from(new Set(data.apis.map((a) => a.source_domain).filter(Boolean))).sort() as string[]
      : [],
  );

  function hintSource(col: string): string | undefined {
    if (col.includes("_")) return "banner";
    if (col.includes(".")) return "colleague";
    return undefined;
  }
</script>

{#if loading}
  <div class="pad"><p class="dim">Loading column profile…</p></div>
{:else if error}
  <div class="pad"><p class="error">{error}</p></div>
{:else if data}
  <article class="profile">
    <header>
      <div class="crumb-row">
        <span class="crumb">Column</span>
      </div>
      <div class="title-row">
        <h1 class="col-name">{data.column}</h1>
        {#if data.inferredTable}
          <button class="badge table-badge" onclick={() => onSelectTable(data!.inferredTable!)}>
            table → {data.inferredTable}
          </button>
        {/if}
      </div>
      <div class="meta">
        {#if hintSource(data.column)}
          <span class="badge">{hintSource(data.column)}</span>
        {/if}
        <span class="badge">{fmt(data.distinctApis)} APIs</span>
        <span class="badge">{fmt(data.occurrences)} refs</span>
      </div>
    </header>

    <section class="glance">
      <div class="label">at a glance</div>
      <div class="glance-grid">
        {#if data.atAGlance.byStatus.length}
          <div class="glance-card">
            <div class="glance-label">status</div>
            <ul>
              {#each data.atAGlance.byStatus as row}
                <li>
                  <span class="status-dot status-{row.release_status ?? 'unknown'}"></span>
                  {row.release_status ?? "—"}
                  <span class="count">{fmt(row.c)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if data.atAGlance.byFamily.length}
          <div class="glance-card">
            <div class="glance-label">top families</div>
            <ul>
              {#each data.atAGlance.byFamily.slice(0, 6) as row}
                <li>
                  {row.family}
                  <span class="count">{fmt(row.c)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if data.atAGlance.byDomain.length}
          <div class="glance-card">
            <div class="glance-label">domains</div>
            <ul>
              {#each data.atAGlance.byDomain.slice(0, 6) as row}
                <li>
                  {row.source_domain ?? "—"}
                  <span class="count">{fmt(row.c)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </section>

    <div class="main-grid">
      <div class="main-col">
        <div class="filters">
          <label>
            <span class="label">family</span>
            <select bind:value={fFamily}>
              <option value="">all</option>
              {#each uniqueFamilies as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </label>
          <label>
            <span class="label">status</span>
            <select bind:value={fStatus}>
              <option value="">all</option>
              {#each uniqueStatuses as s}
                <option value={s}>{s}</option>
              {/each}
            </select>
          </label>
          <label>
            <span class="label">domain</span>
            <select bind:value={fDomain}>
              <option value="">all</option>
              {#each uniqueDomains as d}
                <option value={d}>{d}</option>
              {/each}
            </select>
          </label>
          <span class="dim small">showing {fmt(filtered.length)} of {fmt(data.apis.length)}</span>
        </div>

        <h2>APIs using {data.column}</h2>
        {#if filtered.length === 0}
          <p class="dim">No APIs match the current filters.</p>
        {:else}
          <ul class="api-list">
            {#each filtered as r}
              <li>
                <button class="api-head" onclick={() => onSelectApi(r.family, r.resource, r.version)}>
                  <span class="family-hint">{r.family.replace(/APIs$/, "")}</span>
                  <span class="sep">/</span>
                  <span class="resource">{r.resource}</span>
                  <span class="sep">/</span>
                  <span class="version">{r.version}</span>
                  {#if r.release_status && r.release_status !== "ga"}
                    <span class="badge-mini">{r.release_status}</span>
                  {/if}
                  {#if r.source_domain}
                    <span class="badge-mini">{r.source_domain}</span>
                  {/if}
                </button>
                <div class="api-detail">
                  <div class="field-path">{prettyFieldPath(r.field_path)}</div>
                  <div class="expr">
                    {#each splitExpr(r.raw_expression, tableNames) as part}
                      {#if part.kind === "column"}
                        <button class="token col-token" onclick={(e) => { e.stopPropagation(); onSelectColumn(part.text); }}>{part.text}</button>
                      {:else if part.kind === "table"}
                        <button class="token tbl-token" onclick={(e) => { e.stopPropagation(); onSelectTable(part.text); }}>{part.text}</button>
                      {:else}
                        <span class="expr-text">{part.text}</span>
                      {/if}
                    {/each}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <aside class="side-col">
        {#if data.otherColumnsOnTable.length}
          <section>
            <h3>Other columns on {data.inferredTable ?? "table"}</h3>
            <ul class="col-list">
              {#each data.otherColumnsOnTable as c}
                <li>
                  <button class="token col-token" onclick={() => onSelectColumn(c.column_name)}>{c.column_name}</button>
                  <span class="count">{fmt(c.api_count)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
        {#if data.cooccursWith.length}
          <section>
            <h3>Co-occurs with</h3>
            <p class="dim tiny">columns that appear alongside {data.column} in the same API responses — useful when migrating a multi-column SQL query.</p>
            <ul class="col-list">
              {#each data.cooccursWith as c}
                <li>
                  <button class="token col-token" onclick={() => onSelectColumn(c.column_name)}>{c.column_name}</button>
                  <span class="count">{fmt(c.shared_apis)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </aside>
    </div>
  </article>
{/if}

<style>
  .pad { padding: var(--space-5) var(--space-6); }
  .dim { color: var(--fg-dim); }
  .error { color: var(--danger); }
  .tiny { font-size: 10.5px; }
  .small { font-size: 10.5px; }

  .profile {
    padding: var(--space-5) var(--space-6);
    max-width: 1200px;
    margin: 0 auto;
  }

  header .crumb-row { color: var(--fg-dim); font-size: var(--fs-sm); letter-spacing: 0.1em; text-transform: uppercase; }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin: var(--space-1-5) 0 var(--space-2);
  }
  h1.col-name {
    margin: 0;
    color: var(--accent);
    font-size: var(--fs-xl);
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }
  .meta { display: flex; gap: var(--space-1-5); margin-bottom: var(--space-3); }
  .badge {
    font-size: var(--fs-xs);
    padding: 1px var(--space-2);
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--fg-dim);
  }
  button.badge {
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-xs);
  }
  button.badge.table-badge {
    color: var(--warn);
    border-color: var(--warn);
  }
  button.badge.table-badge:hover { background: var(--border); }

  section.glance {
    margin-bottom: var(--space-5);
  }
  .label {
    color: var(--fg-dim);
    font-size: var(--fs-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .glance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-1-5);
  }
  .glance-card {
    border: 1px solid var(--border);
    padding: var(--space-3);
    background: var(--bg-panel);
  }
  .glance-label {
    color: var(--fg-dim);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: var(--space-1);
  }
  .glance-card ul { list-style: none; margin: 0; padding: 0; }
  .glance-card li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0) 0;
    font-size: 11.5px;
    border-bottom: 1px dotted var(--border);
  }
  .glance-card li:last-child { border-bottom: none; }
  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-dim);
    margin-right: var(--space-1);
  }
  .status-dot.status-ga { background: var(--fg); }
  .status-dot.status-beta { background: var(--warn); }

  .main-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
    gap: var(--space-6);
  }
  @media (max-width: 1000px) {
    .main-grid { grid-template-columns: 1fr; }
  }
  .main-col h2, .side-col h3 {
    color: var(--fg-bright);
    font-size: var(--fs-sm);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: var(--space-4) 0 var(--space-2);
    padding-bottom: var(--space-1);
    border-bottom: 1px dotted var(--border);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .filters label { display: flex; align-items: center; gap: var(--space-1-5); }
  .filters select {
    font: inherit;
    font-size: var(--fs-sm);
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: var(--space-0) var(--space-1-5);
  }

  ul.api-list { list-style: none; margin: 0; padding: 0; }
  ul.api-list li {
    border-top: 1px dotted var(--border);
    padding: var(--space-1-5) 0;
  }
  .api-head {
    font: inherit;
    background: transparent;
    border: none;
    color: var(--fg);
    cursor: pointer;
    padding: 0;
    text-align: left;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1-5);
    font-size: var(--fs-base);
  }
  .api-head:hover { color: var(--accent); }
  .api-head .family-hint { color: var(--fg-dim); }
  .api-head .resource { color: var(--fg-bright); font-weight: 500; }
  .api-head .version { color: var(--fg-dim); font-variant-numeric: tabular-nums; }
  .api-head .sep { color: var(--fg-dim); }
  .badge-mini {
    font-size: 9px;
    padding: 0 5px;
    border: 1px solid var(--border);
    color: var(--fg-dim);
  }
  .api-detail {
    margin-top: var(--space-1);
    padding-left: 18px;
    font-size: var(--fs-sm);
  }
  .field-path { color: var(--fg); font-family: var(--font-mono); opacity: 0.85; }
  .expr { color: var(--fg-dim); font-family: var(--font-mono); margin-top: 1px; word-break: break-word; }
  .expr-text { color: var(--fg-dim); }
  button.token {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    background: transparent;
    border: none;
    border-bottom: 1px dotted var(--border-strong);
    color: var(--fg-bright);
    padding: 0;
    cursor: pointer;
  }
  button.token:hover { color: var(--accent); border-bottom-color: var(--accent); }
  button.token.tbl-token { color: var(--warn); border-bottom-color: var(--warn); }

  .side-col section { margin-bottom: var(--space-5); }
  ul.col-list { list-style: none; margin: 0; padding: 0; }
  ul.col-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: 3px 0;
    border-bottom: 1px dotted var(--border);
  }
  .count { color: var(--fg-dim); font-variant-numeric: tabular-nums; font-size: 10.5px; }
</style>
