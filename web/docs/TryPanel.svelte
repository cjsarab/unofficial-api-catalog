<script lang="ts">
  import type { EndpointSchema, OpenAPIParameter } from "../lib/openapi.ts";
  import type { ResponseView } from "./response/types.ts";
  import { decodeQueryValues } from "../lib/url-display.ts";
  import { reprojectFormState, type FormState, type MigrationWarning } from "./try/version-migration.ts";
  import ParamsTab from "./try/ParamsTab.svelte";
  import HeadersTab from "./try/HeadersTab.svelte";
  import BodyTab from "./try/BodyTab.svelte";
  import VerbSafetyModal from "./try/VerbSafetyModal.svelte";

  type Props = {
    family: string;
    resource: string;
    version: string;
    focused: { method: string; path: string } | null;
    activeEnv: { id: string; name: string; production: boolean } | null;
    region: "us" | "ca" | "eu" | "ap";
    onSend: (view: ResponseView) => void;
    onAbort: () => void;
  };
  let { family, resource, version, focused, activeEnv, region, onSend, onAbort }: Props = $props();

  const REDACT_RE = /password|secret|token|key|ssn|creditCard/i;

  // Module-level state: per-endpoint-key FormState map. Survives re-mounts
  // within the same SPA session; cleared on reload.
  const states = new Map<string, FormState>();
  const schemas = new Map<string, EndpointSchema>();

  const endpointKey = $derived(focused ? `${focused.method} ${focused.path}` : null);
  const autoAccept = $derived("application/vnd.hedtech.integration.v" + version.split(".")[0] + "+json");

  let currentSchema = $state<EndpointSchema | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  let warnings = $state<MigrationWarning[]>([]);

  function freshState(): FormState {
    return {
      pathParams: {}, queryParams: {}, criteria: {},
      headers: [], body: { mode: "raw", text: "" }, headersOverridden: {},
    };
  }

  let state = $state<FormState>(freshState());

  // On endpoint/version change: fetch schema, re-project state if we have one.
  $effect(() => {
    if (!focused || !family || !resource || !version) {
      currentSchema = null;
      return;
    }
    loading = true;
    loadError = null;
    const url = `/api/apis/${encodeURIComponent(family)}/${encodeURIComponent(resource)}/endpoint?method=${encodeURIComponent(focused.method)}&path=${encodeURIComponent(focused.path)}&version=${encodeURIComponent(version)}`;
    fetch(url)
      .then(async (r) => {
        // 404 means this endpoint doesn't exist in the chosen version — that's
        // not an error, it's a legitimate state (e.g. the user switched from
        // v12 /api/persons to v8 which uses /person/persons). Render the
        // "not in this version" branch instead of a scary red banner.
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EndpointSchema>;
      })
      .then((schema) => {
        if (schema === null) {
          currentSchema = null;
          warnings = [];
          return;
        }
        const key = endpointKey!;
        const existingSchema = schemas.get(key);
        const existingState = states.get(key) ?? freshState();
        const { nextState, warnings: ws } = existingSchema
          ? reprojectFormState(existingState, existingSchema, schema)
          : { nextState: existingState, warnings: [] as MigrationWarning[] };
        states.set(key, nextState);
        schemas.set(key, schema);
        state = nextState;
        currentSchema = schema;
        warnings = ws;
      })
      .catch((e: Error) => { loadError = e.message; currentSchema = null; })
      .finally(() => { loading = false; });
  });

  // Persist state on edits.
  function persist(next: FormState) {
    state = next;
    if (endpointKey) states.set(endpointKey, next);
  }

  // Tab state.
  let tab = $state<"params" | "headers" | "body">("params");

  // Computed URL
  const computedUrl = $derived.by<string>(() => {
    if (!focused) return "";
    let url = focused.path;
    for (const [name, val] of Object.entries(state.pathParams)) {
      url = url.replace(`{${name}}`, encodeURIComponent(val));
    }
    const qs: string[] = [];
    for (const [name, val] of Object.entries(state.queryParams)) {
      if (val === "" || val === undefined) continue;
      qs.push(`${encodeURIComponent(name)}=${encodeURIComponent(val)}`);
    }
    // Criteria-style object query params: each one builds its own JSON object
    // (e.g. `?criteria={names:[{firstName:X}]}&personFilter={personFilter:{id:Y}}`).
    for (const [paramName, perParam] of Object.entries(state.criteria)) {
      const obj: Record<string, unknown> = {};
      for (const [rk, leaves] of Object.entries(perParam)) {
        obj[rk] = [Object.fromEntries(Object.entries(leaves).filter(([, v]) => v !== ""))];
      }
      if (Object.keys(obj).length === 0) continue;
      qs.push(`${encodeURIComponent(paramName)}=${encodeURIComponent(JSON.stringify(obj))}`);
    }
    return url + (qs.length ? "?" + qs.join("&") : "");
  });

  const counts = $derived.by(() => {
    const params = Object.values(state.pathParams).filter((v) => v !== "").length
                 + Object.values(state.queryParams).filter((v) => v !== "").length
                 + Object.values(state.criteria).reduce(
                     (n, perParam) => n + Object.values(perParam).reduce(
                       (m, leaves) => m + Object.values(leaves).filter((v) => v !== "").length,
                       0,
                     ),
                     0,
                   );
    const headers = state.headers.filter((h) => h.name && h.value).length + (state.headersOverridden["Accept"] ? 0 : 1); // +1 for the auto Accept row
    return { params, headers };
  });

  // Send flow
  let sending = $state(false);
  let amberNames = $state<Set<string>>(new Set());
  let globalError = $state<string | null>(null);
  let safetyModalOpen = $state(false);
  let skipSafety = false;

  function validate(): string[] {
    const missing: string[] = [];
    const params = currentSchema?.parameters ?? [];
    for (const p of params) {
      // Header + cookie params aren't surfaced in ParamsTab — the HeadersTab
      // (and the auto-injected Accept from the version dropdown) owns those.
      // Validating them here would false-flag required headers like the
      // Ellucian `accept: application/vnd.hedtech.integration.vN+json` param.
      if (p.in !== "path" && p.in !== "query") continue;
      const required = p.in === "path" || p.required;
      if (!required) continue;
      const bag = p.in === "path" ? state.pathParams : state.queryParams;
      if (!bag[p.name] || bag[p.name] === "") missing.push(p.name);
    }
    return missing;
  }

  async function doSend() {
    if (!focused || !currentSchema) return;
    const missing = validate();
    if (missing.length > 0) {
      amberNames = new Set(missing);
      globalError = "Fill in required fields";
      return;
    }
    amberNames = new Set();
    globalError = null;

    // Verb safety
    const isProd = activeEnv?.production === true;
    const mutating = focused.method !== "GET" && focused.method !== "HEAD";
    if (isProd && mutating && !skipSafety) {
      safetyModalOpen = true;
      return;
    }
    skipSafety = false;

    await performSend();
  }

  let inflightCtl: AbortController | null = null;

  async function performSend() {
    if (!focused || !currentSchema) return;

    // Cancel-previous: aborting any in-flight send. App mirrors the UI state through onSend/onAbort.
    if (inflightCtl) {
      inflightCtl.abort();
      onAbort();
    }
    const ctl = new AbortController();
    inflightCtl = ctl;

    sending = true;
    const t0 = performance.now();
    try {
      const headers = new Headers();
      const hasCustomAccept = state.headersOverridden["Accept"] === true;
      if (!hasCustomAccept) headers.set("Accept", autoAccept);
      for (const h of state.headers) {
        if (h.name && h.value) headers.set(h.name, h.value);
      }
      let body: BodyInit | undefined;
      if (focused.method !== "GET" && focused.method !== "HEAD" && focused.method !== "DELETE") {
        body = state.body.text;
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      }
      const res = await fetch(
        `/api/ethos${computedUrl.startsWith("/") ? computedUrl : "/" + computedUrl}`,
        { method: focused.method, headers, body, signal: ctl.signal },
      );
      const bodyText = await res.text();
      const ct = res.headers.get("content-type");

      let proxyError: ResponseView["proxyError"] | undefined;
      if (!res.ok && ct?.startsWith("application/json")) {
        try {
          const parsed = JSON.parse(bodyText) as { error?: string; detail?: string; envId?: string };
          if (parsed && typeof parsed.error === "string") {
            proxyError = { error: parsed.error, detail: parsed.detail, envId: parsed.envId };
          }
        } catch { /* not our structured error */ }
      }

      const headersObj: Record<string, string> = {};
      res.headers.forEach((v, k) => { headersObj[k.toLowerCase()] = v; });

      const authMs = Number(res.headers.get("x-proxy-auth-ms") ?? 0);
      const requestMs = Number(res.headers.get("x-proxy-request-ms") ?? 0);
      const responseMs = Number(res.headers.get("x-proxy-response-ms") ?? 0);
      const reqBytes = Number(res.headers.get("x-proxy-request-bytes") ?? 0);
      const respBytes = Number(res.headers.get("x-proxy-response-bytes") ?? bodyText.length);

      const requestHeadersObj: Record<string, string> = {};
      headers.forEach((v, k) => { requestHeadersObj[k.toLowerCase()] = v; });

      const view: ResponseView = {
        status: res.status,
        statusText: res.statusText,
        requestMethod: focused.method,
        requestUrl: computedUrl,
        headers: headersObj,
        requestHeaders: requestHeadersObj,
        bodyText,
        contentType: ct,
        timings: {
          authMs: Number.isFinite(authMs) ? authMs : 0,
          requestMs: Number.isFinite(requestMs) ? requestMs : 0,
          responseMs: Number.isFinite(responseMs) ? responseMs : 0,
          totalMs: Math.round(performance.now() - t0),
        },
        bytes: {
          requestBytes: Number.isFinite(reqBytes) ? reqBytes : 0,
          responseBytes: Number.isFinite(respBytes) ? respBytes : 0,
        },
        proxyError,
      };
      onSend(view);
    } catch (e) {
      // Aborted by a subsequent send: do nothing (App will have received onAbort above, and the new send will call onSend).
      if ((e as { name?: string }).name === "AbortError") return;
      onSend({
        status: 0,
        statusText: "Network error",
        requestMethod: focused.method,
        requestUrl: computedUrl,
        headers: {},
        requestHeaders: {},
        bodyText: String((e as Error).message),
        contentType: null,
        timings: { authMs: 0, requestMs: 0, responseMs: 0, totalMs: Math.round(performance.now() - t0) },
        bytes: { requestBytes: 0, responseBytes: 0 },
      });
    } finally {
      if (inflightCtl === ctl) inflightCtl = null;
      sending = false;
    }
  }

  function keydown(e: KeyboardEvent) {
    if (safetyModalOpen) return;
    if (e.key === "F5" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      skipSafety = e.shiftKey && e.key === "F5";
      doSend();
    }
  }

  function redactBody(text: string): string {
    // Replace values of fields whose names match REDACT_RE.
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      function walk(v: unknown): unknown {
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === "object") {
          const out: Record<string, unknown> = {};
          for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
            out[k] = REDACT_RE.test(k) ? "[REDACTED]" : walk(sub);
          }
          return out;
        }
        return v;
      }
      return JSON.stringify(walk(obj), null, 2);
    } catch { return text; }
  }
</script>

<svelte:window onkeydown={keydown} />

<section class="tp">
  {#if !focused}
    <p class="empty">Select an endpoint in the docs pane to try it.</p>
  {:else if loading}
    <p class="empty">Loading schema…</p>
  {:else if loadError}
    <p class="err">Could not load endpoint schema: {loadError}</p>
  {:else if !currentSchema}
    <p class="err">This endpoint isn't in v{version}. Pick another, or revert the version.</p>
  {:else}
    <!-- URL bar -->
    <div class="url-bar">
      <span class="method method-{focused.method.toLowerCase()}">{focused.method}</span>
      <code class="url" title={computedUrl}>{decodeQueryValues(computedUrl)}</code>
      <button class="send" onclick={doSend} disabled={sending || !activeEnv}
              title={!activeEnv ? "Select an environment in the top bar to send requests." : ""}>
        {sending ? "Sending…" : "[F5] Send"}
      </button>
    </div>

    {#if globalError}
      <div class="banner err">{globalError}</div>
    {/if}
    {#if warnings.length > 0}
      {#each warnings as w}
        <div class="banner warn">
          {#if w.kind === "orphan-path-param" || w.kind === "orphan-query-param"}
            Fields from the previous version not present in v{version}: {w.names.join(", ")}
          {:else if w.kind === "coercion-failed"}
            Previous value for <code>{w.name}</code> didn't fit the new schema.
          {:else if w.kind === "criteria-undocumented"}
            <code>{w.paramName}: {w.rootKey}.{w.leafPath}</code> is no longer documented in v{version}.
          {/if}
        </div>
      {/each}
    {/if}

    <nav class="tabs">
      <button class:active={tab === "params"} onclick={() => (tab = "params")}>Params ({counts.params})</button>
      <button class:active={tab === "headers"} onclick={() => (tab = "headers")}>Headers ({counts.headers})</button>
      <button class:active={tab === "body"} onclick={() => (tab = "body")}>Body</button>
    </nav>

    <div class="tab-body">
      {#if tab === "params"}
        <ParamsTab
          parameters={currentSchema.parameters}
          pathValues={state.pathParams}
          queryValues={state.queryParams}
          criteriaValues={state.criteria}
          onPathChange={(n, v) => persist({ ...state, pathParams: { ...state.pathParams, [n]: v } })}
          onQueryChange={(n, v) => persist({ ...state, queryParams: { ...state.queryParams, [n]: v } })}
          onCriteriaChange={(name, c) => {
            const next = { ...state.criteria };
            // Drop the param entry entirely if it's empty, so the URL builder
            // doesn't emit "?paramName=%7B%7D" for an untouched filter.
            const isEmpty = Object.values(c).every((leaves) => Object.keys(leaves).length === 0);
            if (isEmpty) delete next[name]; else next[name] = c;
            persist({ ...state, criteria: next });
          }}
          amberNames={amberNames}
          undocumentedCriteria={warnings.filter((w): w is Extract<MigrationWarning, { kind: "criteria-undocumented" }> => w.kind === "criteria-undocumented")}
        />
      {:else if tab === "headers"}
        <HeadersTab
          headers={state.headers}
          onChange={(h) => persist({ ...state, headers: h })}
          autoAccept={autoAccept}
          acceptOverridden={state.headersOverridden["Accept"] === true}
          onAcceptOverriddenChange={(v) => persist({ ...state, headersOverridden: { ...state.headersOverridden, Accept: v } })}
        />
      {:else}
        <BodyTab
          method={focused.method}
          requestBody={currentSchema.requestBody}
          mode={state.body.mode}
          onModeChange={(m) => persist({ ...state, body: { ...state.body, mode: m } })}
          text={state.body.text}
          onTextChange={(t) => persist({ ...state, body: { ...state.body, text: t } })}
          formValue={undefined}
          onFormValueChange={(v) => persist({ ...state, body: { ...state.body, text: JSON.stringify(v, null, 2) } })}
        />
      {/if}
    </div>
  {/if}

</section>

{#if safetyModalOpen && activeEnv && focused}
  <VerbSafetyModal
    envName={activeEnv.name}
    region={region}
    method={focused.method}
    url={computedUrl}
    bodyPreview={state.body.text ? redactBody(state.body.text).split("\n").slice(0, 12).join("\n") : ""}
    onConfirm={() => { safetyModalOpen = false; performSend(); }}
    onCancel={() => { safetyModalOpen = false; }}
  />
{/if}

<style>
  .tp { display: flex; flex-direction: column; height: 100%; font-family: ui-monospace, monospace; font-size: 12px; color: var(--fg, #a9ff68); }
  .empty, .err { padding: 12px; color: var(--fg-dim, #6ba544); font-style: italic; }
  .err { color: var(--danger); }
  .url-bar {
    display: flex; gap: 6px; align-items: center;
    padding: 6px 8px; background: var(--bg-panel, #152815);
    border-bottom: 1px solid var(--border, #2a4a2a);
  }
  .method { padding: 2px 6px; font-weight: bold; font-size: 11px; flex: 0 0 auto; }
  .method-get { background: var(--method-get-bg); color: var(--method-get-fg); }
  .method-post { background: var(--method-post-bg); color: var(--method-post-fg); }
  .method-put, .method-patch { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .url { flex: 1 1 0; overflow-wrap: anywhere; color: var(--fg-bright, #cfff9a); }
  .send {
    background: var(--bg, #0d120d); color: var(--fg-bright, #cfff9a);
    border: 1px solid var(--border-strong, #6ba544); padding: 4px 10px;
    font-family: inherit; cursor: pointer;
  }
  .send:disabled { opacity: 0.5; cursor: not-allowed; }
  .banner { padding: 4px 10px; font-size: 11px; }
  .banner.err { background: var(--danger-bg); color: var(--danger); border-left: 3px solid var(--danger-border); }
  .banner.warn { background: var(--warn-bg); color: var(--warn); border-left: 3px solid var(--warn-border); }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border, #2a4a2a); padding: 0 4px; }
  .tabs button {
    background: transparent; color: var(--fg-dim, #6ba544);
    border: 1px solid transparent; border-bottom: none;
    padding: 4px 10px; font-family: inherit; cursor: pointer; font-size: 11px;
  }
  .tabs button.active {
    background: var(--bg-panel, #152815); color: var(--fg, #a9ff68);
    border-color: var(--border, #2a4a2a);
  }
  .tab-body { flex: 1 1 0; overflow: auto; padding: 8px; }
</style>
