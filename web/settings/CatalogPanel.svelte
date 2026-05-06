<script lang="ts">
  import { formatBytes } from "../docs/response/format.ts";

  type Validation = {
    path: string;
    valid: boolean;
    exists: boolean;
    readable: boolean;
    isDirectory: boolean;
    familiesFound: { name: string; resourceCount: number; yamlCount: number }[];
    familiesMissing: string[];
    yamlCount: number;
    totalSizeBytes: number;
    suggestedParent?: string;
    isZip?: boolean;
    warnings: string[];
    errors: string[];
  };

  type Progress = {
    total: number;
    processed: number;
    inserted: number;
    skipped: number;
    errors: number;
    durationMs: number;
    currentFile?: string;
  };

  type IndexStats = { processed: number; total: number; durationMs: number; errors: number };

  type Props = {
    catalogPath?: string;
    onRefresh: () => void | Promise<void>;
  };
  let { catalogPath, onRefresh }: Props = $props();

  // Pre-fill so a path tweak is a one-character edit. Settings only opens in
  // app mode, so catalogPath is always defined here — no need to react to it
  // becoming defined later.
  let pathInput = $state(catalogPath ?? "");
  let validation = $state<Validation | null>(null);
  let validating = $state(false);
  let browsing = $state(false);
  let running = $state(false);
  let progress = $state<Progress | null>(null);
  let indexStats = $state<IndexStats | null>(null);
  let toast = $state<string | null>(null);
  let clearing = $state(false);
  let validateTimer: ReturnType<typeof setTimeout> | undefined;

  const trimmedInput = $derived(pathInput.trim());
  const pathChanged = $derived(trimmedInput !== "" && trimmedInput !== (catalogPath ?? ""));
  const canChangeAndIndex = $derived(pathChanged && validation?.valid === true && !running);
  const canRescan = $derived(!!catalogPath && !running);

  const fmt = (n: number) => n.toLocaleString("en-US");

  function onPathInput(e: Event) {
    pathInput = (e.target as HTMLInputElement).value;
    clearTimeout(validateTimer);
    validation = null;
    const t = pathInput.trim();
    if (t && t !== (catalogPath ?? "")) {
      validateTimer = setTimeout(() => doValidate(t), 400);
    }
  }

  async function doValidate(p: string) {
    if (!p.trim()) { validation = null; return; }
    validating = true;
    try {
      const res = await fetch("/api/catalog/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      if (res.ok) validation = (await res.json()) as Validation;
    } finally {
      validating = false;
    }
  }

  async function pickFolder() {
    browsing = true;
    toast = null;
    try {
      const res = await fetch("/api/catalog/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initialPath: pathInput || undefined }),
      });
      if (!res.ok) {
        toast = "Browse dialog failed — try typing the path directly.";
        return;
      }
      const body = (await res.json()) as { picked?: string; cancelled?: boolean; error?: string };
      if (body.error) { toast = `Browse error: ${body.error}`; return; }
      if (body.cancelled) return;
      if (body.picked) {
        pathInput = body.picked;
        await doValidate(body.picked);
      }
    } finally {
      browsing = false;
    }
  }

  function useSuggestion(p: string) {
    pathInput = p;
    doValidate(p);
  }

  async function runScan(path: string, savePath: boolean) {
    if (running) return;
    running = true;
    progress = null;
    indexStats = null;
    toast = null;
    try {
      if (savePath) {
        const saveRes = await fetch("/api/config/catalog-path", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });
        if (!saveRes.ok) {
          toast = "Could not save the chosen path.";
          return;
        }
      }

      await new Promise<void>((resolvePromise) => {
        const url = `/api/index/scan-stream?path=${encodeURIComponent(path)}`;
        const source = new EventSource(url);
        source.addEventListener("progress", (e: MessageEvent) => {
          progress = JSON.parse(e.data);
        });
        source.addEventListener("done", (e: MessageEvent) => {
          indexStats = JSON.parse(e.data);
          source.close();
          resolvePromise();
        });
        source.addEventListener("error", (e: MessageEvent) => {
          const msg = typeof (e as MessageEvent).data === "string"
            ? (() => {
                try {
                  return (JSON.parse((e as MessageEvent).data) as { message?: string }).message ?? "stream error";
                } catch {
                  return "stream error";
                }
              })()
            : "stream disconnected";
          toast = `Indexing error: ${msg}`;
          source.close();
          resolvePromise();
        });
      });

      await onRefresh();
    } finally {
      running = false;
    }
  }

  async function rescan() {
    if (!catalogPath) return;
    await runScan(catalogPath, false);
  }

  async function changeAndIndex() {
    if (!canChangeAndIndex) return;
    await runScan(trimmedInput, true);
  }

  async function clearIndex() {
    const ok = window.confirm(
      "Delete the local SQLite index? Your catalog folder and API keys are untouched — only the parsed index on disk is removed. You'll need to re-index after.",
    );
    if (!ok) return;
    clearing = true;
    toast = null;
    try {
      const res = await fetch("/api/index/clear", { method: "POST" });
      if (!res.ok) { toast = "Clear failed."; return; }
      const body = (await res.json()) as { removed: { apis: number; files: number } };
      toast = `Cleared ${body.removed.apis.toLocaleString()} APIs and ${body.removed.files.toLocaleString()} file records.`;
      await onRefresh();
    } finally {
      clearing = false;
    }
  }
</script>

<section class="catalog-panel">
  <header><h2>Catalog</h2></header>

  <div class="block">
    <h3>Current path</h3>
    {#if catalogPath}
      <code class="path">{catalogPath}</code>
    {:else}
      <p class="muted">No catalog configured.</p>
    {/if}
  </div>

  <div class="block">
    <h3>Re-scan</h3>
    <p class="muted small">Refresh the index against the saved path. Use after Ellucian publishes new specs.</p>
    <button onclick={rescan} disabled={!canRescan}>Re-scan current catalog</button>
  </div>

  <div class="block">
    <h3>Change path</h3>
    <p class="muted small">Point at a different APICatalog folder and re-index.</p>
    <div class="picker-row">
      <input
        type="text"
        placeholder='D:\path\to\APICatalog'
        spellcheck="false"
        value={pathInput}
        oninput={onPathInput}
        disabled={running}
      />
      <button onclick={pickFolder} disabled={browsing || running}>
        {browsing ? "Picking…" : "Browse…"}
      </button>
    </div>

    {#if validating}
      <p class="muted small">Validating…</p>
    {/if}

    {#if validation && pathChanged}
      <section class="validation {validation.valid ? 'ok' : 'err'}">
        {#if validation.valid}
          <h4>Looks good</h4>
          <dl class="stats compact">
            <dt>families</dt><dd>{fmt(validation.familiesFound.length)} of 20 present</dd>
            <dt>specs</dt><dd>{fmt(validation.yamlCount)} YAML files</dd>
            <dt>size</dt><dd>{formatBytes(validation.totalSizeBytes)}</dd>
          </dl>
        {:else}
          <h4>Not a valid catalog path</h4>
          <ul>{#each validation.errors as e}<li>{e}</li>{/each}</ul>
        {/if}
        {#if validation.warnings.length}
          <h5>Warnings</h5>
          <ul class="warn">{#each validation.warnings as w}<li>{w}</li>{/each}</ul>
        {/if}
        {#if validation.suggestedParent}
          <p>
            <button class="link" onclick={() => useSuggestion(validation!.suggestedParent!)}>
              Use the parent folder ({validation.suggestedParent}) instead
            </button>
          </p>
        {/if}
      </section>
    {/if}

    <button class="primary" onclick={changeAndIndex} disabled={!canChangeAndIndex}>
      {running ? "Indexing…" : "Change path & re-index"}
    </button>
  </div>

  {#if running || progress}
    {@const p = progress}
    {@const pct = p ? (p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0) : 0}
    {@const elapsedS = p ? p.durationMs / 1000 : 0}
    {@const rate = p && elapsedS > 0 ? p.processed / elapsedS : 0}
    {@const remaining = p && rate > 0 ? Math.max(0, p.total - p.processed) / rate : null}
    <section class="progress">
      <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
        <div class="progress-fill" style="width: {pct}%"></div>
      </div>
      <div class="progress-meta">
        <span>{p ? `${fmt(p.processed)} / ${fmt(p.total)} specs · ${pct}%` : "Starting…"}</span>
        <span class="dim">
          {p && rate > 0 ? `${Math.round(rate)} files/s` : ""}
          {remaining !== null ? ` · ETA ${Math.round(remaining)}s` : ""}
          {p?.errors ? ` · ${fmt(p.errors)} errors` : ""}
        </span>
      </div>
      {#if p?.currentFile}
        <div class="progress-file dim small" title={p.currentFile}>
          {p.currentFile.split(/[\\/]/).slice(-3).join("/")}
        </div>
      {/if}
    </section>
  {/if}

  {#if indexStats && !running}
    <p class="ok small">
      Indexed {fmt(indexStats.processed)} / {fmt(indexStats.total)} specs in
      {(indexStats.durationMs / 1000).toFixed(1)}s, {fmt(indexStats.errors)} parse errors.
    </p>
  {/if}

  {#if toast}<p class="error">{toast}</p>{/if}

  <div class="block danger">
    <h3>Danger zone</h3>
    <p class="muted small">Delete the local SQLite index. Catalog folder and API keys are untouched — you'll need to re-index after.</p>
    <button class="danger-btn" onclick={clearIndex} disabled={clearing || running}>
      {clearing ? "Clearing…" : "Clear index"}
    </button>
  </div>
</section>

<style>
  .catalog-panel { display: flex; flex-direction: column; gap: var(--space-5); }
  .catalog-panel h2 { font-size: 1.1rem; margin: 0; color: var(--fg); }

  .block { display: flex; flex-direction: column; gap: var(--space-2); }
  .block h3 { font-size: 0.95rem; margin: 0; color: var(--fg-dim); font-weight: 600; }
  .block.danger h3 { color: var(--warn); }

  .path {
    background: var(--bg);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    color: var(--fg);
    word-break: break-all;
  }
  .muted { color: var(--fg-dim); margin: 0; }
  .small { font-size: var(--fs-sm); }

  button {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: var(--space-1-5) 14px;
    cursor: pointer;
    align-self: flex-start;
  }
  button:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  button.primary {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); }
  button.primary:disabled { color: var(--fg-dim); background: var(--bg-raised); border-color: var(--border); }

  button.danger-btn {
    color: var(--warn);
    border-color: var(--warn);
  }
  button.danger-btn:hover:not(:disabled) {
    color: var(--bg);
    background: var(--warn);
    border-color: var(--warn);
  }

  button.link {
    background: transparent;
    border: none;
    color: var(--fg-bright);
    border-bottom: 1px dotted var(--border-strong);
    padding: 0;
    align-self: flex-start;
  }
  button.link:hover:not(:disabled) { color: var(--accent); border-bottom-color: var(--accent); background: transparent; }

  .picker-row { display: flex; gap: var(--space-2); }
  .picker-row input {
    flex: 1;
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: var(--space-1-5) var(--space-2-5);
  }
  .picker-row input:focus { outline: none; border-color: var(--accent); color: var(--accent); }
  .picker-row input:disabled { opacity: 0.6; }

  section.validation {
    border: 1px solid var(--border);
    padding: var(--space-3) var(--space-4);
  }
  section.validation.ok {
    border-color: var(--border-strong);
    background: color-mix(in srgb, var(--bg-raised) 80%, transparent);
  }
  section.validation.err { border-color: var(--danger); }
  section.validation h4 { color: var(--fg-bright); margin: 0 0 var(--space-2); font-size: var(--fs-md); }
  section.validation h5 {
    color: var(--warn);
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  section.validation ul { margin: var(--space-1) 0; padding-left: var(--space-4); list-style: square; }
  section.validation li { padding: 1px 0; }
  section.validation ul.warn li { color: var(--warn); }

  dl {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-2) 0;
  }
  dt { color: var(--fg-dim); text-transform: uppercase; font-size: var(--fs-xs); letter-spacing: 0.14em; }
  dd { margin: 0; color: var(--fg-bright); font-variant-numeric: tabular-nums; }

  section.progress {
    padding: var(--space-3);
    border: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .progress-bar {
    height: 14px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--fg);
    opacity: 0.65;
    transition: width 0.2s linear;
    box-shadow: 0 0 8px var(--fg);
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1-5);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .progress-meta .dim { color: var(--fg-dim); }
  .progress-file {
    margin-top: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p.error {
    color: var(--danger);
    border: 1px solid var(--danger);
    padding: var(--space-1-5) var(--space-2-5);
    margin: 0;
    font-size: var(--fs-sm);
  }
  p.ok { color: var(--fg-bright); margin: 0; }
</style>
