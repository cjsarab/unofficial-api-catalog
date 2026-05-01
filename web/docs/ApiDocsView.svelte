<script lang="ts">
  import { splitExpression, prettyFieldPath } from "../lib/lineage.ts";

  type Version = { version: string; releaseStatus: string | null; isActive: boolean };
  type Endpoint = {
    id: number;
    path: string;
    method: string;
    summary: string | null;
    description: string | null;
    operation_id: string | null;
  };
  type Token = { columnName: string; tableName: string | null; sourceSystem: string | null };
  type LineageField = {
    fieldPath: string;
    rawExpression: string;
    kind: string;
    tokens: Token[];
  };
  type ApiEdge = { to_kind: string; to_ref: string; field_path: string | null };
  type Active = {
    id: number;
    version: string;
    title: string | null;
    description: string | null;
    sourceSystem: string | null;
    sourceDomain: string | null;
    sourceTitle: string | null;
    apiType: string | null;
    releaseStatus: string | null;
    filePath: string;
  };
  type DocsPayload = {
    family: string;
    resource: string;
    active: Active;
    versions: Version[];
    endpoints: Endpoint[];
    fields: LineageField[];
    apiEdges: ApiEdge[];
  };

  type Props = {
    family: string;
    resource: string;
    version?: string;
    onSelectColumn: (name: string) => void;
    onSelectTable: (name: string) => void;
    onVersionChange: (version: string) => void;
    onfocusendpoint: (ep: { method: string; path: string }) => void;
    focusedSlug: string | null;
  };
  let { family, resource, version, onSelectColumn, onSelectTable, onVersionChange, onfocusendpoint, focusedSlug }: Props = $props();

  function endpointSlug(method: string, path: string): string {
    return `${method}-${path.replace(/^\//, "").replace(/\//g, "-").replace(/[{}]/g, "")}`;
  }

  let data = $state<DocsPayload | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let tab = $state<"endpoints" | "fields" | "lineage">("endpoints");
  // AbortController guards against a stale fetch resolving after a newer one.
  let inflight: AbortController | undefined;

  // Keyed load: refetch when any prop changes.
  $effect(() => {
    const key = `${family}/${resource}/${version ?? ""}`;
    load(key);
  });

  async function load(_key: string) {
    inflight?.abort();
    const my = new AbortController();
    inflight = my;
    loading = true;
    error = null;
    try {
      const qs = version ? `?version=${encodeURIComponent(version)}` : "";
      const res = await fetch(
        `/api/apis/${encodeURIComponent(family)}/${encodeURIComponent(resource)}${qs}`,
        { signal: my.signal },
      );
      if (my.signal.aborted) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (my.signal.aborted) return;
        error = body.error ?? `server responded ${res.status}`;
        data = null;
        return;
      }
      const body = (await res.json()) as DocsPayload;
      if (my.signal.aborted) return;
      data = body;
    } catch (err) {
      if ((err as Error).name === "AbortError" || my.signal.aborted) return;
      error = (err as Error).message;
    } finally {
      if (!my.signal.aborted) loading = false;
    }
  }

  // splitExpression / prettyFieldPath live in web/lib/lineage.ts (shared
  // with ColumnProfile, TableProfile).

  // Collect all distinct table names across fields so splitExpression can classify them.
  const tableSet = $derived.by((): Set<string> => {
    if (!data) return new Set();
    const s = new Set<string>();
    for (const f of data.fields) for (const t of f.tokens) if (t.tableName) s.add(t.tableName);
    return s;
  });

  const fmt = (n: number) => n.toLocaleString("en-US");

  // Group fields by their top-level "section" (response / body / paths) for readability.
  const groupedFields = $derived.by(() => {
    if (!data) return [];
    const groups = new Map<string, LineageField[]>();
    for (const f of data.fields) {
      const pretty = prettyFieldPath(f.fieldPath);
      let section = "Schema fields";
      if (pretty.startsWith("GET ") || pretty.startsWith("POST ") || pretty.startsWith("PUT ") || pretty.startsWith("DELETE ") || pretty.startsWith("PATCH ")) {
        section = "Endpoint parameters";
      }
      const list = groups.get(section) ?? [];
      list.push(f);
      groups.set(section, list);
    }
    return [...groups.entries()];
  });

  function onVersionSelect(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (v) onVersionChange(v);
  }
</script>

{#if loading}
  <div class="pad">
    <p class="dim">Loading {family}/{resource}…</p>
  </div>
{:else if error}
  <div class="pad">
    <p class="error">{error}</p>
  </div>
{:else if data}
  <article class="docs">
    <header>
      <div class="breadcrumb">
        <span class="crumb">{data.family}</span>
        <span class="sep">›</span>
        <span class="crumb active">{data.resource}</span>
      </div>
      <div class="title-row">
        <h1>{data.active.title ?? data.resource}</h1>
        <div class="version-picker">
          <label>
            <span class="label">version</span>
            <select onchange={onVersionSelect} value={data.active.version}>
              {#each data.versions as v}
                <option value={v.version}>
                  {v.version}{v.releaseStatus ? ` · ${v.releaseStatus}` : ""}
                </option>
              {/each}
            </select>
          </label>
        </div>
      </div>
      <div class="meta">
        {#if data.active.releaseStatus}
          <span class="badge badge-status status-{data.active.releaseStatus}">{data.active.releaseStatus}</span>
        {/if}
        {#if data.active.sourceSystem}
          <span class="badge">source: {data.active.sourceSystem}</span>
        {/if}
        {#if data.active.sourceDomain}
          <span class="badge">domain: {data.active.sourceDomain}</span>
        {/if}
        {#if data.active.apiType}
          <span class="badge">{data.active.apiType}</span>
        {/if}
      </div>
      {#if data.active.description}
        <p class="description">{data.active.description}</p>
      {/if}
    </header>

    <nav class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "endpoints"} class:active={tab === "endpoints"} onclick={() => (tab = "endpoints")}>
        Endpoints <span class="tab-count">{data.endpoints.length}</span>
      </button>
      <button role="tab" aria-selected={tab === "fields"} class:active={tab === "fields"} onclick={() => (tab = "fields")}>
        Fields &amp; lineage <span class="tab-count">{data.fields.length}</span>
      </button>
      <button role="tab" aria-selected={tab === "lineage"} class:active={tab === "lineage"} onclick={() => (tab = "lineage")}>
        API references <span class="tab-count">{data.apiEdges.length}</span>
      </button>
    </nav>

    {#if tab === "endpoints"}
      <section>
        {#if data.endpoints.length === 0}
          <p class="dim pad">No endpoints declared in this spec.</p>
        {:else}
          <ul class="endpoints">
            {#each data.endpoints as ep}
              {@const slug = endpointSlug(ep.method, ep.path)}
              <li class="endpoint" class:focused={focusedSlug === slug}
                  onclick={() => onfocusendpoint({ method: ep.method, path: ep.path })}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onfocusendpoint({ method: ep.method, path: ep.path }); } }}>
                <div class="endpoint-head">
                  <span class="method method-{ep.method.toLowerCase()}">{ep.method}</span>
                  <code class="path">{ep.path}</code>
                </div>
                {#if ep.summary}<p class="summary">{ep.summary}</p>{/if}
                {#if ep.description}<p class="description short">{ep.description}</p>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if tab === "fields"}
      <section>
        {#if data.fields.length === 0}
          <p class="dim pad">No lineage annotations on this API.</p>
        {:else}
          {#each groupedFields as [section, fields]}
            <h3 class="section-heading">{section} <span class="dim">({fmt(fields.length)})</span></h3>
            <ul class="fields">
              {#each fields as f}
                <li>
                  <div class="field-path">{prettyFieldPath(f.fieldPath)}</div>
                  <div class="expression">
                    {#if f.kind === "column"}
                      {#each splitExpression(f.rawExpression, tableSet) as part}
                        {#if part.kind === "column"}
                          <button class="token col-token" onclick={() => onSelectColumn(part.text)}>{part.text}</button>
                        {:else if part.kind === "table"}
                          <button class="token tbl-token" onclick={() => onSelectTable(part.text)}>{part.text}</button>
                        {:else}
                          <span class="expr-text">{part.text}</span>
                        {/if}
                      {/each}
                    {:else}
                      <span class="sentinel">{f.kind}</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/each}
        {/if}
      </section>
    {:else if tab === "lineage"}
      <section>
        {#if data.apiEdges.length === 0}
          <p class="dim pad">This API declares no <code>x-lineageLookupReferenceObject</code> edges.</p>
        {:else}
          <p class="dim">References from this API to other API resources / DB tables, collected from <code>x-lineageLookupReferenceObject</code>.</p>
          <ul class="edges">
            {#each data.apiEdges as e}
              <li>
                <span class="badge">{e.to_kind}</span>
                {#if e.to_kind === "api-resource"}
                  <span class="edge-ref">{e.to_ref}</span>
                {:else}
                  <button class="token tbl-token" onclick={() => onSelectTable(e.to_ref)}>{e.to_ref}</button>
                {/if}
                {#if e.field_path}
                  <span class="dim small">via {prettyFieldPath(e.field_path)}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <footer class="file-footer">
      <span class="dim small" title={data.active.filePath}>source: {data.active.filePath.split(/[\\/]/).slice(-3).join("/")}</span>
    </footer>
  </article>
{/if}

<style>
  .pad { padding: var(--space-5) var(--space-6); }
  .dim { color: var(--fg-dim); }
  .error { color: var(--danger); }
  .small { font-size: 10.5px; }

  .docs {
    padding: var(--space-5) var(--space-6);
    max-width: 1100px;
    margin: 0 auto;
  }

  header .breadcrumb {
    color: var(--fg-dim);
    font-size: var(--fs-sm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .breadcrumb .crumb.active { color: var(--accent); }
  .breadcrumb .sep { padding: 0 var(--space-2); opacity: 0.5; }

  .title-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
    margin: var(--space-1-5) 0 var(--space-3);
  }
  h1 {
    flex: 1;
    color: var(--accent);
    margin: 0;
    font-size: var(--fs-xl);
    letter-spacing: 0.02em;
  }

  .version-picker label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .version-picker .label {
    color: var(--fg-dim);
    font-size: var(--fs-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .version-picker select {
    font: inherit;
    font-size: var(--fs-base);
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: 3px var(--space-2);
    font-variant-numeric: tabular-nums;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
    margin-bottom: var(--space-3);
  }
  .badge {
    font-size: var(--fs-xs);
    letter-spacing: 0.06em;
    padding: 1px var(--space-2);
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--fg-dim);
    text-transform: lowercase;
  }
  .badge.badge-status { text-transform: uppercase; }
  .badge.status-ga { color: var(--fg-bright); border-color: var(--border-strong); }
  .badge.status-beta { color: var(--warn); border-color: var(--warn); }

  .description {
    color: var(--fg);
    line-height: 1.55;
    white-space: pre-wrap;
    margin: var(--space-3) 0 var(--space-4);
    max-width: 80ch;
  }
  .description.short { margin: var(--space-0) 0; font-size: 11.5px; line-height: 1.45; }

  .tabs {
    display: flex;
    gap: var(--space-0);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--space-4);
  }
  .tabs button {
    font: inherit;
    font-size: var(--fs-sm);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: transparent;
    border: none;
    color: var(--fg-dim);
    padding: var(--space-1-5) var(--space-3) 5px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tabs button:hover:not(.active) { color: var(--fg); }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .tab-count {
    display: inline-block;
    margin-left: var(--space-1);
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  ul { list-style: none; margin: 0; padding: 0; }

  /* Endpoints */
  ul.endpoints li {
    border-bottom: 1px dotted var(--border);
    padding: var(--space-3) 0;
  }
  li.endpoint { cursor: pointer; }
  li.endpoint:hover { background: var(--bg-raised); }
  li.endpoint.focused {
    border: 2px solid var(--border-strong);
    background: var(--bg-raised);
  }
  .endpoint-head { display: flex; align-items: baseline; gap: var(--space-3); }
  /* HTTP method badges use a fixed semantic palette (like git diff colors) so
     GET-is-green and DELETE-is-red muscle memory carries across themes. A subtle
     border keeps every badge distinct from whatever page background the active
     theme happens to use — important on the DOS theme, where the page is blue
     and the POST swatch would otherwise blur into the background. */
  .method {
    display: inline-block;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: var(--space-0) var(--space-1-5);
    min-width: 50px;
    text-align: center;
    border: 1px solid rgba(0, 0, 0, 0.25);
    box-shadow: 0 0 0 1px var(--highlight);
  }
  .method-get    { background: var(--method-get-bg);    color: var(--method-get-fg); }
  .method-post   { background: var(--method-post-bg);   color: var(--method-post-fg); }
  .method-put    { background: var(--method-put-bg);    color: var(--method-put-fg); }
  .method-patch  { background: var(--method-patch-bg);  color: var(--method-patch-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .method-options,
  .method-head,
  .method-trace  { background: var(--method-other-bg);  color: var(--method-other-fg); }
  .path {
    color: var(--fg-bright);
    background: var(--bg-raised);
    padding: 1px var(--space-1-5);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
  }
  .summary { margin: var(--space-1) 0 var(--space-0); color: var(--fg-bright); font-size: var(--fs-base); }

  /* Fields */
  h3.section-heading {
    margin: var(--space-4) 0 var(--space-2);
    color: var(--fg-bright);
    font-size: var(--fs-sm);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  ul.fields li {
    border-top: 1px dotted var(--border);
    padding: var(--space-1) 0;
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.3fr);
    gap: var(--space-4);
  }
  .field-path {
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .expression {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .expr-text { color: var(--fg-dim); }
  .sentinel {
    color: var(--warn);
    font-size: var(--fs-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px dashed var(--warn);
    padding: 0 var(--space-1-5);
  }

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

  /* API edges */
  ul.edges li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-top: 1px dotted var(--border);
  }
  .edge-ref { font-family: var(--font-mono); color: var(--fg-bright); }

  .file-footer {
    margin-top: var(--space-5);
    padding-top: var(--space-3);
    border-top: 1px dotted var(--border);
  }
</style>
