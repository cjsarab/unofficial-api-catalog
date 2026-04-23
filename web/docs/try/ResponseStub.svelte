<script lang="ts">
  type Props = {
    status: number;
    statusText: string;
    durationMs: number;
    headers: Record<string, string>;
    bodyText: string;
    contentType: string | null;
    /** Structured proxy error (when status is ours, not Ethos's). */
    proxyError?: { error: string; detail?: string; envId?: string };
  };
  let { status, statusText, durationMs, headers, bodyText, contentType, proxyError }: Props = $props();

  let headersOpen = $state(false);

  const statusClass = $derived.by(() => {
    if (status >= 200 && status < 300) return "ok";
    if (status >= 300 && status < 400) return "redir";
    if (status >= 400 && status < 500) return "warn";
    if (status >= 500) return "err";
    return "unknown";
  });

  const prettyBody = $derived.by(() => {
    if (!contentType?.startsWith("application/json")) return bodyText;
    try {
      return JSON.stringify(JSON.parse(bodyText), null, 2);
    } catch { return bodyText; }
  });

  const errorBanner = $derived.by(() => {
    if (!proxyError) return null;
    switch (proxyError.error) {
      case "no-active-environment": return "No environment is active. Pick one in the top bar.";
      case "no-api-key":             return `The active environment has no API key set. Edit it in Settings → Environments.`;
      case "auth-failed":            return `Couldn't exchange the API key for a JWT: ${proxyError.detail ?? "(no detail)"}`;
      case "upstream-unreachable":   return `Couldn't reach Ethos: ${proxyError.detail ?? "(no detail)"}`;
      default: return null;
    }
  });
</script>

<section class="rs">
  <header>
    <span class="status status-{statusClass}">{status} {statusText}</span>
    <span class="duration">· {durationMs} ms</span>
  </header>
  {#if errorBanner}
    <div class="err-banner">{errorBanner}</div>
  {/if}
  <pre class="body">{prettyBody}</pre>
  <button class="hd-toggle" onclick={() => (headersOpen = !headersOpen)}>
    {headersOpen ? "▾" : "▸"} Headers
  </button>
  {#if headersOpen}
    <dl class="hd">
      {#each Object.entries(headers) as [k, v]}
        <dt>{k}</dt><dd>{v}</dd>
      {/each}
    </dl>
  {/if}
</section>

<style>
  .rs { font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; border-top: 1px solid var(--border, #2a4a2a); }
  header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .status { font-weight: bold; }
  .status-ok { color: #8fe68f; }
  .status-redir { color: var(--fg-dim, #6ba544); }
  .status-warn { color: #d4a548; }
  .status-err { color: #ff8a8a; }
  .duration { color: var(--fg-dim, #6ba544); }
  .err-banner {
    background: #2a1818; color: #ffb0b0; border: 1px solid #bf5050;
    padding: 4px 8px; margin-bottom: 6px;
  }
  .body {
    background: var(--bg, #0a100a); padding: 8px; border: 1px solid var(--border, #2a4a2a);
    max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 0;
  }
  .hd-toggle {
    margin-top: 6px; background: transparent; color: var(--fg-dim, #6ba544);
    border: none; font-family: inherit; cursor: pointer; padding: 0;
  }
  .hd { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin-top: 4px; }
  .hd dt { color: var(--fg-dim, #6ba544); }
  .hd dd { color: var(--fg, #a9ff68); margin: 0; overflow-wrap: anywhere; }
</style>
