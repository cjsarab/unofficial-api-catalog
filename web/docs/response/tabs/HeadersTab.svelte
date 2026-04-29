<script lang="ts">
  import { decodeQueryValues } from "../../../lib/url-display.ts";

  type Props = {
    responseHeaders: Record<string, string>;
    requestHeaders: Record<string, string>;
    requestMethod?: string;
    requestUrl?: string;
  };
  let { responseHeaders, requestHeaders, requestMethod, requestUrl }: Props = $props();

  let urlEncoded = $state(false);
  const displayedUrl = $derived(
    !requestUrl ? "" : urlEncoded ? requestUrl : decodeQueryValues(requestUrl),
  );

  function copyUrl() {
    if (!displayedUrl) return;
    navigator.clipboard?.writeText(displayedUrl).catch(() => { /* best effort */ });
  }

  const REDACT_KEYS = new Set(["authorization", "cookie", "set-cookie"]);

  type SubTab = "response" | "request";
  let activeSub = $state<SubTab>("response");
  let revealed = $state<Set<string>>(new Set());

  function toggleReveal(key: string) {
    const next = new Set(revealed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    revealed = next;
  }

  function isRedacted(key: string): boolean {
    return REDACT_KEYS.has(key.toLowerCase());
  }

  function sortedEntries(h: Record<string, string>): [string, string][] {
    return Object.entries(h).sort(([a], [b]) => a.localeCompare(b));
  }

  function copyActive() {
    const h = activeSub === "response" ? responseHeaders : requestHeaders;
    const text = sortedEntries(h)
      .map(([k, v]) => {
        const shown = !isRedacted(k) || revealed.has(`${activeSub[0]}:${k}`);
        return `${k}: ${shown ? v : "***"}`;
      })
      .join("\n");
    navigator.clipboard?.writeText(text).catch(() => {
      /* best effort */
    });
  }

  const activeHeaders = $derived(activeSub === "response" ? responseHeaders : requestHeaders);
  const activeCount = $derived(Object.keys(activeHeaders).length);
  const respCount = $derived(Object.keys(responseHeaders).length);
  const reqCount = $derived(Object.keys(requestHeaders).length);
</script>

<section class="hdr">
  <nav class="sub-tabs" role="tablist" aria-label="Headers section">
    <button
      role="tab"
      aria-selected={activeSub === "response"}
      class:active={activeSub === "response"}
      onclick={() => (activeSub = "response")}
    >
      Response <span class="count">({respCount})</span>
    </button>
    <button
      role="tab"
      aria-selected={activeSub === "request"}
      class:active={activeSub === "request"}
      onclick={() => (activeSub = "request")}
    >
      Request <span class="count">({reqCount})</span>
    </button>
    <span class="spacer"></span>
    <button class="copy" onclick={copyActive} aria-label="Copy visible section">
      Copy {activeSub === "response" ? "response" : "request"} headers
    </button>
  </nav>

  {#if activeSub === "request" && requestUrl}
    <div class="url-block">
      <div class="url-row">
        <span class="method method-{(requestMethod ?? "").toLowerCase()}">{requestMethod}</span>
        <code class="url-value">{displayedUrl}</code>
      </div>
      <div class="url-actions">
        <button
          class="toggle"
          onclick={() => (urlEncoded = !urlEncoded)}
          aria-pressed={urlEncoded}
          title="Toggle URL-encoded vs decoded query values"
        >
          {urlEncoded ? "Show decoded" : "Show raw (encoded)"}
        </button>
        <button class="toggle" onclick={copyUrl} aria-label="Copy URL">Copy URL</button>
      </div>
    </div>
  {/if}

  <dl>
    {#each sortedEntries(activeHeaders) as [k, v]}
      {@const revealKey = `${activeSub[0]}:${k}`}
      <dt>{k}</dt>
      <dd>
        {#if isRedacted(k) && !revealed.has(revealKey)}
          <button class="reveal" onclick={() => toggleReveal(revealKey)}>[show]</button>
          <span class="redacted">***</span>
        {:else}
          <span>{v}</span>
          {#if isRedacted(k)}
            <button class="reveal" onclick={() => toggleReveal(revealKey)}>[hide]</button>
          {/if}
        {/if}
      </dd>
    {/each}
  </dl>

  {#if activeCount === 0}
    <p class="empty">No headers.</p>
  {/if}
</section>

<style>
  .hdr {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-mono);
  }
  .sub-tabs {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 4px var(--space-3);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .sub-tabs button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid transparent;
    border-bottom: 2px solid transparent;
    padding: 3px 10px;
    cursor: pointer;
  }
  .sub-tabs button:hover {
    color: var(--accent);
  }
  .sub-tabs button.active {
    color: var(--fg);
    background: var(--bg-raised);
    border-color: var(--border);
    border-bottom-color: var(--accent);
  }
  .sub-tabs .count {
    color: var(--fg-dim);
  }
  .sub-tabs .spacer {
    flex: 1;
  }
  .sub-tabs .copy {
    border: 1px solid var(--border);
    padding: 2px 8px;
  }
  .sub-tabs .copy:hover {
    border-color: var(--accent);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--space-3);
    margin: 0;
    padding: var(--space-3);
    font-size: 12px;
    overflow: auto;
    flex: 1;
  }
  dt {
    color: var(--fg-dim);
  }
  dd {
    color: var(--fg);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .redacted {
    color: var(--fg-dim);
  }
  .reveal {
    font: inherit;
    background: transparent;
    border: none;
    padding: 0 6px 0 0;
    color: var(--fg-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .reveal:hover {
    color: var(--accent);
  }
  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--fg-dim);
    font-size: 12px;
  }

  .url-block {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .url-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .method {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: bold;
    flex-shrink: 0;
  }
  .method-get    { background: var(--method-get-bg); color: var(--method-get-fg); }
  .method-post   { background: var(--method-post-bg); color: var(--method-post-fg); }
  .method-put,
  .method-patch  { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .url-value {
    color: var(--fg);
    overflow-wrap: anywhere;
    word-break: break-all;
    flex: 1;
  }
  .url-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .url-actions .toggle {
    font: inherit;
    font-family: var(--font-mono);
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .url-actions .toggle:hover { color: var(--accent); border-color: var(--accent); }
  .url-actions .toggle[aria-pressed="true"] { color: var(--fg); border-color: var(--border-strong); background: var(--bg-raised); }
</style>
