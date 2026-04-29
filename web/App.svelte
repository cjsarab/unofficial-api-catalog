<script lang="ts">
  import Shell from "./shell/Shell.svelte";
  import TopBar from "./shell/TopBar.svelte";
  import StatusBar from "./shell/StatusBar.svelte";
  import PanePlaceholder from "./shell/PanePlaceholder.svelte";
  import CatalogOverview from "./shell/CatalogOverview.svelte";
  import Sidebar from "./sidebar/Sidebar.svelte";
  import ApiDocsView from "./docs/ApiDocsView.svelte";
  import TryPanel from "./docs/TryPanel.svelte";
  import ColumnProfile from "./docs/ColumnProfile.svelte";
  import TableProfile from "./docs/TableProfile.svelte";
  import CommandPalette from "./shell/CommandPalette.svelte";
  import SettingsView from "./settings/SettingsView.svelte";
  import ResponsePanel from "./docs/response/ResponsePanel.svelte";
  import ResponseEmpty from "./docs/response/ResponseEmpty.svelte";
  import type { ResponseView } from "./docs/response/types.ts";

  type CatalogPathStatus = "ok" | "missing" | "invalid" | "none";
  type Region = "us" | "ca" | "eu" | "ap";

  type AppConfig = {
    catalogPath?: string;
    recentPaths: string[];
    catalogPathStatus?: CatalogPathStatus;
    catalogPathError?: string;
    region: Region;
  };

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

  type LastScanStatus = "running" | "complete" | "aborted" | "error";
  type LastScan = {
    status: LastScanStatus | null;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
  };
  type Summary = {
    apiCount: number;
    endpointCount: number;
    columnCount: number;
    distinctColumnCount: number;
    lineageEdgeCount: number;
    families: Array<{ family: string; c: number }>;
    domains: Array<{ source_domain: string | null; c: number }>;
    errors: number;
    lastScan: LastScan;
  };

  type ThemeName = "phosphor" | "amber" | "dos" | "beige";

  type Environment = {
    id: string;
    name: string;
    production: boolean;
    hasApiKey: boolean;
  };

  // ---- state ------------------------------------------------------------
  let config = $state<AppConfig | null>(null);
  let summary = $state<Summary | null>(null);
  // Distinct from `summary === null` because a valid configured catalog
  // still produces a null summary while the dashboard fetch is in flight.
  // Without this flag, mode flips to "wizard" between the moment config
  // arrives and the moment summary arrives — that's the wizard flash. (B-001)
  let summaryLoaded = $state(false);
  let serverVersion = $state<string | undefined>(undefined);
  let loadError = $state<string | null>(null);
  let envs = $state<Environment[] | null>(null);
  let activeEnvId = $state<string | null>(null);

  let theme = $state<ThemeName>("phosphor");
  const THEME_STORAGE = "acx:theme:v1";

  // ---- routing (backed by browser History API so back/forward works) ---
  type Route =
    | { kind: "overview" }
    | { kind: "api"; family: string; resource: string; version?: string }
    | { kind: "column"; name: string }
    | { kind: "table"; name: string };

  type SettingsSection = "environments" | "appearance" | "catalog";

  let route = $state<Route>({ kind: "overview" });
  let focusedEndpoint = $state<{ method: string; path: string } | null>(null);
  let currentResponse = $state<ResponseView | null>(null);
  let isSending = $state(false);
  // Settings is a modal over the current route, not a route of its own — so
  // closing it returns the user to whatever they were doing.
  let settingsOpen = $state(false);
  let settingsSection = $state<SettingsSection>("environments");

  function routeToPath(r: Route): string {
    switch (r.kind) {
      case "overview":
        return "/";
      case "api":
        return r.version
          ? `/apis/${encodeURIComponent(r.family)}/${encodeURIComponent(r.resource)}/${encodeURIComponent(r.version)}`
          : `/apis/${encodeURIComponent(r.family)}/${encodeURIComponent(r.resource)}`;
      case "column":
        return `/columns/${encodeURIComponent(r.name)}`;
      case "table":
        return `/tables/${encodeURIComponent(r.name)}`;
    }
  }

  // Legacy /settings/<section> URLs: pop the modal open on top of overview
  // instead of being a real destination. Returns the settings section if the
  // URL looked like a settings deep-link, so the caller can normalise the URL.
  function consumeSettingsPath(pathname: string): SettingsSection | null {
    const segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segs[0] !== "settings") return null;
    const section = segs[1] ?? "environments";
    if (section === "environments" || section === "appearance" || section === "catalog") {
      return section;
    }
    return "environments";
  }

  function pathToRoute(pathname: string): Route {
    const segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segs.length === 0) return { kind: "overview" };
    const [head, ...rest] = segs;
    if (head === "apis" && rest.length >= 2) {
      return { kind: "api", family: rest[0]!, resource: rest[1]!, version: rest[2] };
    }
    if (head === "columns" && rest.length >= 1) return { kind: "column", name: rest[0]! };
    if (head === "tables" && rest.length >= 1) return { kind: "table", name: rest[0]! };
    return { kind: "overview" };
  }

  // Push a new route both into our reactive state and the browser history.
  // `replace` swaps the current history entry (used on initial load) instead of
  // adding to the stack, so the browser's Back button moves between meaningful
  // destinations rather than intermediate state.
  function navigate(r: Route, replace = false) {
    route = r;
    const path = routeToPath(r);
    if (typeof window !== "undefined" && window.history) {
      if (replace) window.history.replaceState({ route: r }, "", path);
      else window.history.pushState({ route: r }, "", path);
    }
  }

  function selectApi(family: string, resource: string, version?: string) {
    navigate({ kind: "api", family, resource, version });
  }
  function selectColumn(name: string) {
    navigate({ kind: "column", name });
  }
  function selectTable(name: string) {
    navigate({ kind: "table", name });
  }
  function goOverview() {
    navigate({ kind: "overview" });
  }
  function openSettings(section: SettingsSection = "environments") {
    settingsSection = section;
    settingsOpen = true;
  }
  function closeSettings() {
    settingsOpen = false;
  }
  function changeVersion(v: string) {
    if (route.kind === "api") {
      // Treat version changes as replace — the Back button should return to the
      // previous page, not cycle through every version the user clicked.
      navigate({ kind: "api", family: route.family, resource: route.resource, version: v }, true);
    }
  }

  // Handle browser back/forward.
  function onPopState(e: PopStateEvent) {
    const next = ((e.state as { route?: Route } | null)?.route) ?? pathToRoute(window.location.pathname);
    route = next;
  }

  // wizard state
  let wizardPath = $state("");
  let wizardValidation = $state<Validation | null>(null);
  let wizardValidating = $state(false);
  let wizardBrowsing = $state(false);
  let wizardIndexing = $state(false);
  let wizardToast = $state<string | null>(null);
  let wizardIndexStats = $state<{ processed: number; total: number; durationMs: number; errors: number } | null>(null);
  let wizardProgress = $state<{
    total: number;
    processed: number;
    inserted: number;
    skipped: number;
    errors: number;
    durationMs: number;
    currentFile?: string;
  } | null>(null);
  let validateTimer: ReturnType<typeof setTimeout> | undefined;
  let clearing = $state(false);

  // ---- derived ----------------------------------------------------------
  const activeEnvName = $derived(
    envs && activeEnvId ? (envs.find((e) => e.id === activeEnvId)?.name ?? "(none)") : "(none)",
  );
  const activeEnv = $derived(envs && activeEnvId ? (envs.find((e) => e.id === activeEnvId) ?? null) : null);

  const focusedSlug = $derived.by(() => {
    if (!focusedEndpoint) return null;
    return focusedEndpoint.method + "-" + focusedEndpoint.path.replace(/^\//, "").replace(/\//g, "-").replace(/[{}]/g, "");
  });

  function writeFragment(ep: { method: string; path: string } | null) {
    if (!ep) { history.replaceState(null, "", location.pathname + location.search); return; }
    const slug = ep.method + "-" + ep.path.replace(/^\//, "").replace(/\//g, "-").replace(/[{}]/g, "");
    history.replaceState(null, "", location.pathname + location.search + "#endpoint=" + slug);
  }

  function readFragment(): { method: string; path: string } | null {
    const hash = location.hash;
    const m = hash.match(/#endpoint=([A-Za-z]+)-(.+)$/);
    if (!m) return null;
    const method = m[1]!.toUpperCase();
    return { method, path: "/" + m[2]!.replace(/-/g, "/") };
  }

  function focusEndpoint(ep: { method: string; path: string }) {
    focusedEndpoint = ep;
    writeFragment(ep);
  }

  // Clear focus when the user navigates to a different API (or leaves API
  // routes entirely). Without the API-id check, a focus from `/apis/A/foo`
  // survives navigation to `/apis/B/bar` and TryPanel re-fetches B's schema
  // for A's endpoint path → 404 → "isn't in v1.0.0" orphan warning. (B-002)
  let prevApiKey = $state<string | null>(null);
  $effect(() => {
    const apiKey = route.kind === "api" ? `${route.family}/${route.resource}` : null;
    if (apiKey !== prevApiKey && focusedEndpoint !== null) {
      focusedEndpoint = null;
      writeFragment(null);
    }
    prevApiKey = apiKey;
  });

  // Re-read fragment when route arrives at an API detail view.
  $effect(() => {
    if (route.kind === "api" && !focusedEndpoint) {
      const fromHash = readFragment();
      if (fromHash) focusedEndpoint = fromHash;
    }
  });

  let mode = $derived.by((): "loading" | "wizard" | "app" => {
    if (!config) return "loading";
    if (!config.catalogPath) return "wizard";
    if (config.catalogPathStatus && config.catalogPathStatus !== "ok") return "wizard";
    // Don't decide wizard-vs-app until we know whether the configured catalog
    // produced a non-empty summary — otherwise the wizard flashes for one
    // frame on every cold start. (B-001)
    if (!summaryLoaded) return "loading";
    if (!summary || summary.apiCount === 0) return "wizard";
    return "app";
  });

  // ---- theme ------------------------------------------------------------
  function applyTheme(t: ThemeName) {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_STORAGE, t);
    } catch {
      /* ignore */
    }
  }

  function restoreTheme() {
    try {
      const saved = localStorage.getItem(THEME_STORAGE);
      if (saved && ["phosphor", "amber", "dos", "beige"].includes(saved)) {
        applyTheme(saved as ThemeName);
      }
    } catch {
      /* ignore */
    }
  }

  // ---- lifecycle --------------------------------------------------------
  $effect(() => {
    restoreTheme();
    // Restore the route from the current URL on first paint. If the URL is a
    // legacy /settings/... deep link, pop the modal open over the overview
    // rather than navigating into a standalone settings screen.
    const section = consumeSettingsPath(window.location.pathname);
    if (section) {
      navigate({ kind: "overview" }, true);
      openSettings(section);
    } else {
      const initial = pathToRoute(window.location.pathname);
      navigate(initial, true);
    }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onGlobalKey);
    loadAll();
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onGlobalKey);
    };
  });

  async function loadAll() {
    try {
      const [statusRes, configRes, envsRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/config"),
        fetch("/api/environments"),
      ]);
      if (statusRes.ok) serverVersion = ((await statusRes.json()) as { version?: string }).version;
      if (configRes.ok) config = (await configRes.json()) as AppConfig;
      if (envsRes.ok) {
        const data = (await envsRes.json()) as { envs: Environment[]; activeId: string | null };
        envs = data.envs;
        activeEnvId = data.activeId;
      }
    } catch (err) {
      loadError = (err as Error).message;
      return;
    }

    if (config?.catalogPath && config.catalogPathStatus === "ok") {
      await loadDashboardData();
      if (!summary || summary.apiCount === 0) {
        wizardPath = config.catalogPath;
        await doValidate(config.catalogPath);
      }
    } else if (config?.catalogPath) {
      wizardPath = config.catalogPath;
      await doValidate(config.catalogPath);
    }
  }

  async function loadDashboardData() {
    try {
      const res = await fetch("/api/index/summary");
      if (res.ok) summary = (await res.json()) as Summary;
    } catch (err) {
      loadError = (err as Error).message;
    } finally {
      summaryLoaded = true;
    }
  }

  // ---- wizard actions ---------------------------------------------------
  function onPathInput(e: Event) {
    wizardPath = (e.target as HTMLInputElement).value;
    clearTimeout(validateTimer);
    wizardValidation = null;
    validateTimer = setTimeout(() => doValidate(wizardPath), 400);
  }

  async function doValidate(p: string) {
    if (!p.trim()) {
      wizardValidation = null;
      return;
    }
    wizardValidating = true;
    try {
      const res = await fetch("/api/catalog/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      if (res.ok) wizardValidation = (await res.json()) as Validation;
    } finally {
      wizardValidating = false;
    }
  }

  async function pickFolder() {
    wizardBrowsing = true;
    wizardToast = null;
    try {
      const res = await fetch("/api/catalog/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initialPath: wizardPath || undefined }),
      });
      if (!res.ok) {
        wizardToast = "Browse dialog failed — try typing the path directly.";
        return;
      }
      const body = (await res.json()) as { picked?: string; cancelled?: boolean; error?: string };
      if (body.error) {
        wizardToast = `Browse error: ${body.error}`;
        return;
      }
      if (body.cancelled) return;
      if (body.picked) {
        wizardPath = body.picked;
        await doValidate(body.picked);
      }
    } finally {
      wizardBrowsing = false;
    }
  }

  function useSuggestion(p: string) {
    wizardPath = p;
    doValidate(p);
  }

  async function confirmAndIndex() {
    if (!wizardValidation?.valid || !wizardPath) return;
    wizardIndexing = true;
    wizardIndexStats = null;
    wizardProgress = null;
    wizardToast = null;

    try {
      const saveRes = await fetch("/api/config/catalog-path", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: wizardPath }),
      });
      if (!saveRes.ok) {
        wizardToast = "Could not save the chosen path.";
        wizardIndexing = false;
        return;
      }

      await new Promise<void>((resolvePromise) => {
        const url = `/api/index/scan-stream?path=${encodeURIComponent(wizardPath)}`;
        const source = new EventSource(url);
        source.addEventListener("progress", (e: MessageEvent) => {
          wizardProgress = JSON.parse(e.data);
        });
        source.addEventListener("done", (e: MessageEvent) => {
          wizardIndexStats = JSON.parse(e.data);
          source.close();
          resolvePromise();
        });
        source.addEventListener("error", (e: MessageEvent) => {
          const msg =
            typeof (e as MessageEvent).data === "string"
              ? (() => {
                  try {
                    return (JSON.parse((e as MessageEvent).data) as { message?: string }).message ?? "stream error";
                  } catch {
                    return "stream error";
                  }
                })()
              : "stream disconnected";
          wizardToast = `Indexing error: ${msg}`;
          source.close();
          resolvePromise();
        });
      });

      config = ((await (await fetch("/api/config")).json())) as AppConfig;
      await loadDashboardData();
    } finally {
      wizardIndexing = false;
    }
  }

  async function changeCatalog() {
    wizardPath = config?.catalogPath ?? "";
    wizardValidation = null;
    summary = null;
    if (wizardPath) await doValidate(wizardPath);
  }

  // Re-scan the existing catalog without going back through the wizard. Used
  // by the "indexing incomplete" banner + status-bar chip when the previous
  // scan was aborted (tab close, kill, error).
  let rescanInFlight = $state(false);
  async function triggerRescan() {
    if (rescanInFlight || !config?.catalogPath) return;
    rescanInFlight = true;
    wizardProgress = null;
    wizardToast = null;
    try {
      await new Promise<void>((resolvePromise) => {
        const url = `/api/index/scan-stream?path=${encodeURIComponent(config!.catalogPath!)}`;
        const source = new EventSource(url);
        source.addEventListener("progress", (e: MessageEvent) => {
          wizardProgress = JSON.parse(e.data);
        });
        source.addEventListener("done", () => {
          source.close();
          resolvePromise();
        });
        source.addEventListener("error", () => {
          source.close();
          resolvePromise();
        });
      });
      await loadDashboardData();
    } finally {
      rescanInFlight = false;
      wizardProgress = null;
    }
  }

  async function clearIndexAction() {
    const ok = window.confirm(
      "Delete the local SQLite index? Your catalog folder and API keys are untouched — only the parsed index on disk is removed. You'll need to re-index after.",
    );
    if (!ok) return;
    clearing = true;
    try {
      const res = await fetch("/api/index/clear", { method: "POST" });
      if (!res.ok) {
        wizardToast = "Clear failed.";
        return;
      }
      const body = (await res.json()) as { removed: { apis: number; files: number } };
      summary = null;
      await loadAll();
      wizardToast = `Cleared ${body.removed.apis.toLocaleString()} APIs and ${body.removed.files.toLocaleString()} file records.`;
    } finally {
      clearing = false;
    }
  }

  async function setRegion(r: Region) {
    const res = await fetch("/api/config/region", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: r }),
    });
    if (res.ok && config) {
      config = { ...config, region: r };
    }
  }

  let paletteOpen = $state(false);
  function openCommandPalette() {
    paletteOpen = true;
  }
  function closeCommandPalette() {
    paletteOpen = false;
  }

  // Global Ctrl+K (and Cmd+K, for the one Mac user who might open this via WSL)
  function onGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      paletteOpen = !paletteOpen;
    }
    if (e.key === "Escape" && settingsOpen) {
      e.preventDefault();
      closeSettings();
    }
  }

  // ---- helpers ----------------------------------------------------------
  const fmt = (n: number) => n.toLocaleString("en-US");
  function fmtBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(1)} GB`;
  }
</script>

{#if mode === "loading"}
  <main class="boot">
    <div class="tag">API Catalog Explorer</div>
    <h1>Loading…</h1>
    {#if loadError}<p class="error">{loadError}</p>{/if}
  </main>
{:else if mode === "wizard"}
  <main class="boot">
    <div class="tag">API Catalog Explorer · first-run{serverVersion ? ` · v${serverVersion}` : ""}</div>
    <h1>Point me at your APICatalog folder</h1>

    {#if config?.catalogPath && config.catalogPathStatus && config.catalogPathStatus !== "ok"}
      <p class="notice">
        <strong>Your previously saved catalog path isn't reachable.</strong><br />
        <code>{config.catalogPath}</code><br />
        {config.catalogPathError ?? (config.catalogPathStatus === "missing" ? "Folder no longer exists." : "Folder no longer looks like a catalog.")}
        <br /><br />
        Fix the path below, point at a new folder, or <button class="link" onclick={clearIndexAction} disabled={clearing}>clear the index</button> to start fresh.
      </p>
    {:else}
      <p>
        Download Ellucian's API catalog zip, unzip it anywhere on your disk, then paste the path or pick it
        below. Partial catalogs (only some families) are fine.
      </p>
    {/if}

    <div class="picker-row">
      <input
        type="text"
        placeholder='D:\path\to\APICatalog'
        spellcheck="false"
        value={wizardPath}
        oninput={onPathInput}
        disabled={wizardIndexing}
      />
      <button onclick={pickFolder} disabled={wizardBrowsing || wizardIndexing}>
        {wizardBrowsing ? "Picking…" : "Browse…"}
      </button>
    </div>

    {#if wizardValidating}
      <p class="dim small">Validating…</p>
    {/if}

    {#if wizardValidation && wizardPath}
      <section class="validation {wizardValidation.valid ? 'ok' : 'err'}">
        {#if wizardValidation.valid}
          <h3>Looks good</h3>
          <dl class="stats compact">
            <dt>families</dt><dd>{fmt(wizardValidation.familiesFound.length)} of 20 present</dd>
            <dt>specs</dt><dd>{fmt(wizardValidation.yamlCount)} YAML files</dd>
            <dt>size</dt><dd>{fmtBytes(wizardValidation.totalSizeBytes)}</dd>
          </dl>
        {:else}
          <h3>Not a valid catalog path</h3>
          <ul>{#each wizardValidation.errors as e}<li>{e}</li>{/each}</ul>
        {/if}
        {#if wizardValidation.warnings.length}
          <h4>Warnings</h4>
          <ul class="warn">{#each wizardValidation.warnings as w}<li>{w}</li>{/each}</ul>
        {/if}
        {#if wizardValidation.suggestedParent}
          <p>
            <button class="link" onclick={() => useSuggestion(wizardValidation!.suggestedParent!)}>
              Use the parent folder ({wizardValidation.suggestedParent}) instead
            </button>
          </p>
        {/if}
      </section>
    {/if}

    {#if (config?.recentPaths ?? []).length}
      <section>
        <h2>Recent</h2>
        <ul class="probes">
          {#each config?.recentPaths ?? [] as p}
            <li><button class="link" onclick={() => useSuggestion(p)}>{p}</button></li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="actions">
      <button class="primary" disabled={!wizardValidation?.valid || wizardIndexing} onclick={confirmAndIndex}>
        {wizardIndexing ? "Indexing…" : "Index now"}
      </button>
    </div>

    {#if wizardIndexing || wizardProgress}
      {@const p = wizardProgress}
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

    {#if wizardToast}<p class="error">{wizardToast}</p>{/if}
    {#if wizardIndexStats && !wizardIndexing}
      <p class="small ok">
        Indexed {fmt(wizardIndexStats.processed)} / {fmt(wizardIndexStats.total)} specs in
        {(wizardIndexStats.durationMs / 1000).toFixed(1)}s, {fmt(wizardIndexStats.errors)} parse errors.
      </p>
    {/if}
  </main>
{:else if mode === "app" && summary}
  <Shell>
    {#snippet topBar()}
      <TopBar
        {theme}
        onthemechange={applyTheme}
        envs={envs ?? []}
        {activeEnvId}
        onactivate={async (id) => {
          const res = await fetch(`/api/environments/${encodeURIComponent(id)}/activate`, { method: "POST" });
          if (res.ok) activeEnvId = id;
        }}
        onopensettings={() => openSettings()}
        openCommandPalette={openCommandPalette}
      />
    {/snippet}
    {#snippet left()}
      <Sidebar
        onSelectApi={selectApi}
        onSelectColumn={selectColumn}
        onSelectTable={selectTable}
        selectedFamily={route.kind === "api" ? route.family : undefined}
        selectedResource={route.kind === "api" ? route.resource : undefined}
        selectedColumn={route.kind === "column" ? route.name : undefined}
        selectedTable={route.kind === "table" ? route.name : undefined}
      />
    {/snippet}
    {#snippet middle()}
      {#if route.kind === "overview"}
        <CatalogOverview
          onSelectColumn={selectColumn}
          onSelectTable={selectTable}
          lastScan={summary?.lastScan ?? null}
          rescanInFlight={rescanInFlight}
          onRescan={triggerRescan}
        />
      {:else if route.kind === "api"}
        <ApiDocsView
          family={route.family}
          resource={route.resource}
          version={route.version}
          onSelectColumn={selectColumn}
          onSelectTable={selectTable}
          onVersionChange={changeVersion}
          {focusedSlug}
          onfocusendpoint={focusEndpoint}
        />
      {:else if route.kind === "column"}
        <ColumnProfile
          name={route.name}
          onSelectColumn={selectColumn}
          onSelectTable={selectTable}
          onSelectApi={selectApi}
        />
      {:else if route.kind === "table"}
        <TableProfile
          name={route.name}
          onSelectColumn={selectColumn}
          onSelectApi={selectApi}
        />
      {/if}
    {/snippet}
    {#snippet right()}
      {#if route.kind === "api"}
        <TryPanel
          family={route.family}
          resource={route.resource}
          version={route.version ?? ""}
          focused={focusedEndpoint}
          activeEnv={activeEnv}
          region={config?.region ?? "us"}
          onSend={(view) => { currentResponse = view; isSending = false; }}
          onAbort={() => { isSending = false; /* previous view stays visible until the new one lands */ }}
        />
      {:else}
        <PanePlaceholder
          title="Try API"
          description="Environment-scoped request builder using the active env's Ellucian API key. Ctrl+. to collapse."
          taskNumber={15}
        />
      {/if}
    {/snippet}
    {#snippet response()}
      {#if currentResponse}
        <ResponsePanel
          {...currentResponse}
          sending={isSending}
          onclear={() => (currentResponse = null)}
        />
      {:else}
        <ResponseEmpty />
      {/if}
    {/snippet}
    {#snippet statusBar()}
      <StatusBar
        summary={summary}
        catalogPath={config?.catalogPath}
        env={activeEnvName}
        lastResponse={null}
        lastScan={summary?.lastScan ?? null}
        rescanInFlight={rescanInFlight}
        onRescan={triggerRescan}
      />
    {/snippet}
  </Shell>

  <CommandPalette
    open={paletteOpen}
    onClose={closeCommandPalette}
    onSelectApi={selectApi}
    onSelectColumn={selectColumn}
    onSelectTable={selectTable}
  />

  {#if settingsOpen}
    <!-- Settings modal: overlays the current route so closing returns the
         user to wherever they were. Click-outside and Escape both close. -->
    <div class="settings-backdrop" onclick={closeSettings} role="presentation">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
        <SettingsView
          section={settingsSection}
          envs={envs ?? []}
          activeEnvId={activeEnvId}
          onChange={(nextEnvs, nextActiveId) => {
            envs = nextEnvs;
            activeEnvId = nextActiveId;
          }}
          onClose={closeSettings}
          theme={theme}
          onthemechange={applyTheme}
          catalogPath={config?.catalogPath}
          onsectionchange={(s) => (settingsSection = s)}
          region={config?.region ?? "us"}
          onregionchange={setRegion}
        />
      </div>
    </div>
  {/if}
{/if}

<style>
  main.boot {
    max-width: 760px;
    margin: 6vh auto 4vh;
    padding: var(--space-8) var(--space-6);
    border: 1px solid var(--border);
    background: var(--bg-panel);
  }
  .tag {
    color: var(--fg-dim);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1 {
    color: var(--accent);
    margin: var(--space-1) 0 var(--space-3);
    font-size: 22px;
    letter-spacing: 0.02em;
  }
  h2 {
    color: var(--fg-bright);
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: var(--space-5) 0 var(--space-2);
    border-bottom: 1px dotted var(--border);
    padding-bottom: 4px;
  }
  h3 { color: var(--fg-bright); font-size: 14px; margin: 0 0 var(--space-2); }
  h4 { color: var(--warn); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin: var(--space-3) 0 4px; }
  p { line-height: 1.55; margin: var(--space-3) 0; }
  p.dim { color: var(--fg-dim); font-size: 12px; }
  p.small { font-size: 11px; }
  p.error { color: var(--danger); font-size: 12px; border: 1px solid var(--danger); padding: 6px 10px; }
  p.ok { color: var(--fg-bright); }
  code { background: var(--bg-raised); padding: 1px 6px; border: 1px solid var(--border); }

  button {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: 6px 14px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  button.primary {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
    padding: 8px 20px;
  }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); }
  button.primary:disabled { color: var(--fg-dim); background: var(--bg-raised); border-color: var(--border); }

  button.link {
    background: transparent;
    border: none;
    color: var(--fg-bright);
    text-decoration: none;
    border-bottom: 1px dotted var(--border-strong);
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  button.link:hover:not(:disabled) { color: var(--accent); border-bottom-color: var(--accent); background: transparent; }

  dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-3) 0;
  }
  dl.stats.compact { grid-template-columns: 90px 1fr; }
  dt {
    color: var(--fg-dim);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.14em;
    align-self: center;
  }
  dd {
    margin: 0;
    color: var(--fg-bright);
    font-variant-numeric: tabular-nums;
  }

  ul { padding: 0; margin: var(--space-2) 0; list-style: none; }
  ul.probes li {
    display: flex;
    gap: var(--space-3);
    padding: 2px 0;
    border-bottom: 1px dotted var(--border);
  }
  ul.warn li { color: var(--warn); padding: 2px 0; }

  section.validation {
    border: 1px solid var(--border);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-3) 0;
  }
  section.validation.ok { border-color: var(--border-strong); background: color-mix(in srgb, var(--bg-raised) 80%, transparent); }
  section.validation.err { border-color: var(--danger); }
  section.validation ul { margin: 4px 0; padding-left: 16px; list-style: square; }
  section.validation li { padding: 1px 0; }

  .picker-row { display: flex; gap: var(--space-2); margin: var(--space-3) 0; }
  .picker-row input {
    flex: 1;
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: 6px 10px;
  }
  .picker-row input:focus { outline: none; border-color: var(--accent); color: var(--accent); }

  .actions { margin-top: var(--space-4); }

  section.progress {
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .progress-bar {
    height: 14px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    overflow: hidden;
    position: relative;
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
    margin-top: 6px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .progress-meta .dim { color: var(--fg-dim); }
  .progress-file {
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p.notice {
    border: 1px solid var(--warn);
    background: color-mix(in srgb, var(--bg-raised) 70%, transparent);
    padding: var(--space-3) var(--space-4);
    color: var(--fg-bright);
  }
  p.notice strong { color: var(--warn); }
  p.notice code { color: var(--fg); }

  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 90;
    padding: 4vh 4vw;
  }
  .settings-dialog {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    width: min(960px, 100%);
    max-height: 92vh;
    overflow: auto;
  }

  .route-placeholder {
    padding: var(--space-5) var(--space-6);
    max-width: 1000px;
    margin: 0 auto;
  }
  .route-placeholder .label {
    color: var(--fg-dim);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .route-placeholder h1 {
    color: var(--accent);
    font-size: 20px;
    margin: 6px 0 var(--space-3);
    letter-spacing: 0.02em;
  }
</style>
