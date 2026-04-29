<script lang="ts">
  import type { Json, ResponseView } from "./types.ts";
  import TableTab from "./tabs/TableTab.svelte";
  import RawTab from "./tabs/RawTab.svelte";
  import HeadersTab from "./tabs/HeadersTab.svelte";
  import TimingTab from "./tabs/TimingTab.svelte";
  import { formatMs, isJsonContentType } from "./format.ts";
  import { decodeQueryValues, pathOnly } from "../../lib/url-display.ts";

  type Props = ResponseView & {
    sending: boolean;
    onclear?: () => void;
  };
  let {
    status, statusText, requestMethod, requestUrl,
    headers, requestHeaders, bodyText, contentType,
    timings, bytes, proxyError, sending, onclear,
  }: Props = $props();

  const compactPath = $derived(decodeQueryValues(pathOnly(requestUrl)));

  type Tab = "table" | "raw" | "headers" | "timing";
  let activeTab = $state<Tab>("table");

  const parsedJson = $derived.by<Json | null>(() => {
    if (!isJsonContentType(contentType)) return null;
    try { return JSON.parse(bodyText) as Json; } catch { return null; }
  });

  // When the body changes and the previously-active tab no longer makes sense, fall back to Raw.
  $effect(() => {
    if (activeTab === "table" && parsedJson === null && contentType !== null) {
      activeTab = "raw";
    }
  });

  const statusClass = $derived.by(() => {
    if (status === 0) return "err";
    if (status >= 200 && status < 300) return "ok";
    if (status >= 300 && status < 400) return "redir";
    if (status >= 400 && status < 500) return "warn";
    return "err";
  });

  const errorBanner = $derived.by(() => {
    if (!proxyError) return null;
    switch (proxyError.error) {
      case "no-active-environment": return "No environment is active. Pick one in the top bar.";
      case "no-api-key":             return "The active environment has no API key set. Edit it in Settings → Environments.";
      case "auth-failed":            return `Couldn't exchange the API key for a JWT: ${proxyError.detail ?? "(no detail)"}`;
      case "upstream-unreachable":   return `Couldn't reach Ethos: ${proxyError.detail ?? "(no detail)"}`;
      default: return null;
    }
  });

  function jumpToRaw(_jumpPath: string) {
    // v1: flip to Raw. Scrolling to the exact path is a nice-to-have follow-up.
    activeTab = "raw";
  }
</script>

<section class="panel">
  <header>
    <span class="status status-{statusClass}">{status} {statusText}</span>
    <span class="duration">· {formatMs(timings.totalMs)}</span>
    {#if sending}<span class="sending">· sending…</span>{/if}
    {#if requestUrl}
      <span class="sep">·</span>
      <span class="method method-{requestMethod.toLowerCase()}">{requestMethod}</span>
      <code class="req-path" title={requestUrl}>{compactPath}</code>
    {/if}
    {#if errorBanner}<span class="banner">{errorBanner}</span>{/if}
    <span class="spacer"></span>
    <nav class="tabs" role="tablist">
      <button role="tab" aria-selected={activeTab === "table"}  onclick={() => (activeTab = "table")}>Table</button>
      <button role="tab" aria-selected={activeTab === "raw"}    onclick={() => (activeTab = "raw")}>Raw</button>
      <button role="tab" aria-selected={activeTab === "headers"} onclick={() => (activeTab = "headers")}>Headers</button>
      <button role="tab" aria-selected={activeTab === "timing"} onclick={() => (activeTab = "timing")}>Timing</button>
    </nav>
    {#if onclear}
      <button class="clear" onclick={onclear} aria-label="Clear response">×</button>
    {/if}
  </header>

  <div class="body">
    {#if activeTab === "table"}
      <TableTab json={parsedJson} contentType={contentType} bodyText={bodyText} onJumpToRaw={jumpToRaw} />
    {:else if activeTab === "raw"}
      <RawTab bodyText={bodyText} contentType={contentType} />
    {:else if activeTab === "headers"}
      <HeadersTab responseHeaders={headers} requestHeaders={requestHeaders} />
    {:else}
      <TimingTab timings={timings} bytes={bytes} />
    {/if}
  </div>
</section>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 4px var(--space-3);
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-dim);
  }
  .status { font-weight: bold; }
  .status-ok    { color: var(--accent); }
  .status-redir { color: var(--fg-dim); }
  .status-warn  { color: var(--warn); }
  .status-err   { color: var(--danger); }
  .duration, .sending { color: var(--fg-dim); }
  .sep { color: var(--fg-dim); opacity: 0.5; }
  .method {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: bold;
  }
  .method-get    { background: var(--method-get-bg); color: var(--method-get-fg); }
  .method-post   { background: var(--method-post-bg); color: var(--method-post-fg); }
  .method-put,
  .method-patch  { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .req-path {
    color: var(--fg);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 50ch;
  }
  .banner {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid var(--danger-border);
    padding: 1px 8px;
    font-size: 11px;
  }
  .spacer { flex: 1; }
  .tabs { display: flex; }
  .tabs button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tabs button:hover { color: var(--accent); }
  .tabs button[aria-selected="true"] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .clear {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: none;
    cursor: pointer;
    padding: 0 8px;
    font-size: 16px;
  }
  .clear:hover { color: var(--accent); }
  .body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .body > :global(*) { flex: 1; min-height: 0; }
</style>
