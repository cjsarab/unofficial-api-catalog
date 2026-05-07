<script lang="ts">
  type Environment = {
    id: string;
    name: string;
    production: boolean;
    hasApiKey: boolean;
  };
  type Region = "us" | "ca" | "eu" | "ap";

  type Props = {
    envs: Environment[];
    activeEnvId: string | null;
    onChange: (envs: Environment[], activeEnvId: string | null) => void;
    region: Region;
    onregionchange: (r: Region) => void;
  };
  let { envs, activeEnvId, onChange, region, onregionchange }: Props = $props();

  const REGION_OPTIONS: ReadonlyArray<{ id: Region; label: string; host: string }> = [
    { id: "us", label: "US",           host: "integrate.elluciancloud.com" },
    { id: "ca", label: "Canada",       host: "integrate.elluciancloud.ca" },
    { id: "eu", label: "Europe",       host: "integrate.elluciancloud.ie" },
    { id: "ap", label: "Asia-Pacific", host: "integrate.elluciancloud.com.au" },
  ];

  // Edit state: null = read-only, "new" = adding, <id> = editing that env.
  let editing = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let submitting = $state(false);

  // API key reveal toggle state.
  let apiKeyVisible = $state(false);
  let apiKeyFetching = $state(false);
  let apiKeyFetchError = $state<string | null>(null);

  async function toggleApiKeyVisibility() {
    // If currently hidden and field is empty, fetch the current key from the server.
    if (!apiKeyVisible && fApiKey === "" && editing !== null && editing !== "new") {
      const id = editing;
      apiKeyFetching = true;
      apiKeyFetchError = null;
      try {
        const res = await fetch(`/api/environments/${encodeURIComponent(id)}/api-key`);
        if (!res.ok) {
          apiKeyFetchError = await errorText(res);
          return;
        }
        const data = (await res.json()) as { apiKey: string };
        fApiKey = data.apiKey;
      } catch (e) {
        apiKeyFetchError = (e as Error).message;
        return;
      } finally {
        apiKeyFetching = false;
      }
    }
    apiKeyVisible = !apiKeyVisible;
  }

  // Buffered form fields (kept separate so Cancel is trivial).
  let fName = $state("");
  let fProduction = $state(false);
  let fApiKey = $state("");

  function startAdd() {
    if (editing !== null && !confirm("Discard unsaved changes?")) return;
    editing = "new";
    fName = "";
    fProduction = false;
    fApiKey = "";
    formError = null;
    apiKeyVisible = false;
    apiKeyFetchError = null;
  }

  function startEdit(env: Environment) {
    if (editing !== null && editing !== env.id && !confirm("Discard unsaved changes?")) return;
    editing = env.id;
    fName = env.name;
    fProduction = env.production;
    fApiKey = ""; // blank → leave-unchanged on edit
    formError = null;
    apiKeyVisible = false;
    apiKeyFetchError = null;
  }

  function cancelEdit() {
    editing = null;
    formError = null;
    apiKeyVisible = false;
    apiKeyFetchError = null;
  }

  async function save() {
    formError = null;
    submitting = true;
    try {
      if (editing === "new") {
        const res = await fetch("/api/environments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: fName,
            production: fProduction,
            apiKey: fApiKey,
          }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const created = (await res.json()) as Environment;
        onChange([...envs, created], activeEnvId);
      } else if (editing !== null) {
        const id = editing;
        const body: Record<string, unknown> = {
          name: fName,
          production: fProduction,
        };
        if (fApiKey !== "") body.apiKey = fApiKey;
        const res = await fetch(`/api/environments/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errorText(res));
        const updated = (await res.json()) as Environment;
        onChange(envs.map((e) => (e.id === id ? updated : e)), activeEnvId);
      }
      editing = null;
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function doDelete(env: Environment) {
    if (!confirm(`Delete environment "${env.name}"? This also deletes its API key.`)) return;
    const res = await fetch(`/api/environments/${encodeURIComponent(env.id)}`, { method: "DELETE" });
    if (!res.ok) {
      alert(await errorText(res));
      return;
    }
    const nextEnvs = envs.filter((e) => e.id !== env.id);
    const nextActive = activeEnvId === env.id ? null : activeEnvId;
    onChange(nextEnvs, nextActive);
  }

  async function doActivate(env: Environment) {
    const res = await fetch(`/api/environments/${encodeURIComponent(env.id)}/activate`, { method: "POST" });
    if (!res.ok) {
      alert(await errorText(res));
      return;
    }
    onChange(envs, env.id);
  }

  async function errorText(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
</script>

<section class="envs-panel">
  <div class="region-bar">
    <label>
      <span>Region (applies to all environments)</span>
      <select value={region} onchange={(e) => onregionchange((e.target as HTMLSelectElement).value as Region)}>
        {#each REGION_OPTIONS as opt (opt.id)}
          <option value={opt.id}>{opt.label} ({opt.host})</option>
        {/each}
      </select>
    </label>
  </div>

  <header class="envs-header">
    <h2>Environments ({envs.length})</h2>
    <button class="btn-primary" onclick={startAdd} disabled={editing !== null}>
      + Add environment
    </button>
  </header>

  {#if envs.length === 0 && editing !== "new"}
    <div class="empty-state">
      <p>No environments yet.</p>
      <button class="btn-primary" onclick={startAdd}>+ Add environment</button>
    </div>
  {/if}

  <ul class="envs-list">
    {#if editing === "new"}
      <li class="env-row editing">
        <header class="env-meta">
          <span class="env-name">New environment</span>
          <button class="btn-link" onclick={cancelEdit}>Cancel</button>
        </header>
        {@render form()}
      </li>
    {/if}

    {#each envs as env (env.id)}
      <li class="env-row" class:active={env.id === activeEnvId} class:editing={editing === env.id}>
        <div class="env-row-top">
          <div class="env-meta">
            <span class="env-name">{env.name}</span>
            {#if env.production}<span class="badge badge-prod">PROD</span>{/if}
            {#if env.id === activeEnvId}<span class="badge badge-active">active</span>{/if}
            {#if !env.hasApiKey}<span class="hint-nokey" title="API key not set">•</span>{/if}
          </div>
          <div class="env-actions">
            {#if env.id !== activeEnvId}
              <button onclick={() => doActivate(env)} disabled={editing !== null}>Activate</button>
            {/if}
            <button onclick={() => startEdit(env)} disabled={editing !== null && editing !== env.id}>
              {editing === env.id ? "Editing…" : "Edit"}
            </button>
            <button onclick={() => doDelete(env)} disabled={editing !== null}>Delete</button>
          </div>
        </div>
        {#if editing === env.id}
          {@render form()}
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet form()}
    <div class="form-grid">
      <label>
        <span>Name</span>
        <input type="text" bind:value={fName} placeholder="e.g. apply-prod" />
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={fProduction} />
        <span>Production</span>
      </label>
      <label>
        <span>API key</span>
        <div class="apikey-row">
          <input
            type={apiKeyVisible ? "text" : "password"}
            bind:value={fApiKey}
            placeholder={editing !== "new" && envs.find((e) => e.id === editing)?.hasApiKey
              ? "•••••••• (leave blank to keep)"
              : "required"}
          />
          {#if editing !== "new" && envs.find((e) => e.id === editing)?.hasApiKey}
            <button
              type="button"
              class="reveal-btn"
              onclick={toggleApiKeyVisibility}
              disabled={apiKeyFetching}
              aria-pressed={apiKeyVisible}
            >
              {apiKeyFetching ? "[LOAD]" : apiKeyVisible ? "[HIDE]" : "[SHOW]"}
            </button>
          {/if}
        </div>
        {#if apiKeyFetchError}
          <span class="apikey-error">{apiKeyFetchError}</span>
        {/if}
      </label>

      {#if formError}
        <p class="form-error">{formError}</p>
      {/if}

      <div class="form-actions">
        <button class="btn-primary" onclick={save} disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
        <button class="btn-link" onclick={cancelEdit} disabled={submitting}>Cancel</button>
      </div>
    </div>
  {/snippet}
</section>

<style>
  .envs-panel { display: flex; flex-direction: column; gap: var(--space-4); }
  .envs-header { display: flex; align-items: center; justify-content: space-between; }
  .envs-header h2 { font-size: 1.1rem; margin: 0; color: var(--fg); }

  .region-bar {
    padding: var(--space-3) var(--space-4);
    background: var(--bg-panel);
    border: 1px solid var(--border);
  }
  .region-bar label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .region-bar label > span {
    color: var(--fg-dim);
    font-size: 0.9rem;
  }
  .region-bar select {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
  }

  .btn-primary {
    background: var(--bg-raised);
    color: var(--fg-bright);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) { background: var(--bg-panel); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-link {
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    text-decoration: underline;
  }
  .btn-link:hover:not(:disabled) { color: var(--fg); }

  .empty-state {
    padding: var(--space-6);
    text-align: center;
    color: var(--fg-dim);
    border: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .envs-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }

  .env-row {
    padding: var(--space-3) var(--space-4);
    background: var(--bg-panel);
    border: 1px solid var(--border);
  }
  .env-row.active { border-color: var(--accent-active); }
  .env-row.editing { border-color: var(--border-strong); }

  .env-row-top { display: flex; align-items: center; justify-content: space-between; }
  .env-meta { display: flex; align-items: center; gap: var(--space-3); }
  .env-name { font-weight: 600; color: var(--fg-bright); }
  .badge {
    display: inline-block;
    padding: 0 var(--space-2);
    font-size: 0.75rem;
    border-radius: 2px;
    font-weight: 600;
  }
  .badge-prod { background: var(--danger); color: var(--bg); }
  .badge-active { background: var(--accent-active); color: var(--bg); }
  .hint-nokey { color: var(--warn); font-size: 1.2rem; }

  .env-actions { display: flex; gap: var(--space-2); }
  .env-actions button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .env-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .env-actions button:hover:not(:disabled) { background: var(--bg-raised); }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) 0 0 0;
    border-top: 1px solid var(--border);
    margin-top: var(--space-3);
  }
  .form-grid label { display: flex; flex-direction: column; gap: var(--space-1); font-size: 0.9rem; }
  .form-grid label > span { color: var(--fg-dim); }
  .form-grid input[type="text"],
  .form-grid input[type="url"],
  .form-grid input[type="password"] {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: 0.95rem;
  }
  .form-grid input:focus { outline: 1px solid var(--border-strong); }
  .checkbox-label { flex-direction: row !important; align-items: center; gap: var(--space-2); }
  .muted { color: var(--fg-dim); }

  .form-error {
    color: var(--danger);
    background: var(--bg);
    border: 1px solid var(--danger);
    padding: var(--space-2) var(--space-3);
    margin: 0;
  }
  .form-actions { display: flex; gap: var(--space-3); align-items: center; }

  .apikey-row { display: flex; align-items: stretch; gap: var(--space-2); }
  .apikey-row input { flex: 1; }
  .reveal-btn {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg-dim);
    border: 1px solid var(--border-strong);
    padding: 0 var(--space-3);
    cursor: pointer;
    line-height: 1;
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .reveal-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .reveal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .apikey-error {
    color: var(--danger);
    font-size: 0.85rem;
    margin-top: var(--space-1);
  }
</style>
