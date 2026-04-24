<script lang="ts">
  type Props = {
    responseHeaders: Record<string, string>;
    requestHeaders: Record<string, string>;
  };
  let { responseHeaders, requestHeaders }: Props = $props();

  const REDACT_KEYS = new Set(["authorization", "cookie", "set-cookie"]);

  let reqOpen = $state(false);
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

  function copySection(h: Record<string, string>) {
    const text = sortedEntries(h)
      .map(([k, v]) => `${k}: ${isRedacted(k) && !revealed.has("§" + k) ? "***" : v}`)
      .join("\n");
    navigator.clipboard?.writeText(text).catch(() => { /* best effort */ });
  }
</script>

<section class="hdr">
  <div class="section">
    <header>
      <span class="label">Response headers ({Object.keys(responseHeaders).length})</span>
      <button onclick={() => copySection(responseHeaders)} aria-label="Copy response headers">Copy</button>
    </header>
    <dl>
      {#each sortedEntries(responseHeaders) as [k, v]}
        <dt>{k}</dt>
        <dd>
          {#if isRedacted(k) && !revealed.has("r:" + k)}
            <button class="reveal" onclick={() => toggleReveal("r:" + k)}>[show]</button>
            <span class="redacted">***</span>
          {:else}
            <span>{v}</span>
            {#if isRedacted(k)}
              <button class="reveal" onclick={() => toggleReveal("r:" + k)}>[hide]</button>
            {/if}
          {/if}
        </dd>
      {/each}
    </dl>
  </div>

  <div class="section">
    <header>
      <button class="toggle" onclick={() => (reqOpen = !reqOpen)} aria-expanded={reqOpen}>
        {reqOpen ? "▾" : "▸"} Request headers ({Object.keys(requestHeaders).length})
      </button>
      {#if reqOpen}
        <button onclick={() => copySection(requestHeaders)} aria-label="Copy request headers">Copy</button>
      {/if}
    </header>
    {#if reqOpen}
      <dl>
        {#each sortedEntries(requestHeaders) as [k, v]}
          <dt>{k}</dt>
          <dd>
            {#if isRedacted(k) && !revealed.has("q:" + k)}
              <button class="reveal" onclick={() => toggleReveal("q:" + k)}>[show]</button>
              <span class="redacted">***</span>
            {:else}
              <span>{v}</span>
              {#if isRedacted(k)}
                <button class="reveal" onclick={() => toggleReveal("q:" + k)}>[hide]</button>
              {/if}
            {/if}
          </dd>
        {/each}
      </dl>
    {/if}
  </div>
</section>

<style>
  .hdr { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-4); overflow: auto; height: 100%; }
  .section header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .label {
    color: var(--fg-dim);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  button:hover { color: var(--accent); border-color: var(--accent); }
  button.toggle {
    border: none;
    padding: 0;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--space-3);
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  dt { color: var(--fg-dim); }
  dd { color: var(--fg); margin: 0; overflow-wrap: anywhere; }
  .redacted { color: var(--fg-dim); }
  button.reveal {
    border: none;
    padding: 0 6px 0 0;
    color: var(--fg-dim);
    font-size: 11px;
  }
</style>
