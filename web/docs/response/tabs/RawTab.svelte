<script lang="ts">
  import { tokenize } from "../highlight.ts";
  import { formatBytes } from "../format.ts";

  type Props = {
    bodyText: string;
    contentType: string | null;
  };
  let { bodyText, contentType }: Props = $props();

  const HEAD_SLICE_BYTES = 64 * 1024;
  const HEAD_THRESHOLD_BYTES = 1024 * 1024;

  let prettyOn = $state(true);
  let lineNumbersOn = $state(false);
  let showAll = $state(false);

  const isJson = $derived(!!contentType && contentType.startsWith("application/json"));
  const isTooBig = $derived(bodyText.length > HEAD_THRESHOLD_BYTES);

  // Cheap binary heuristic: any C0 control (except \t \n \r) or replacement char (U+FFFD)
  // in the first 512 chars means the server's text-decode mangled the bytes. Show hex head.
  function looksBinary(s: string): boolean {
    const head = s.slice(0, 512);
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0B\x0C\x0E-\x1F�]/.test(head);
  }
  const isBinary = $derived(!isJson && bodyText.length > 0 && looksBinary(bodyText));

  function hexHead(s: string, bytes: number): string {
    const out: string[] = [];
    const limit = Math.min(s.length, bytes);
    for (let i = 0; i < limit; i += 16) {
      const chunk = s.slice(i, Math.min(i + 16, limit));
      const hex = Array.from(chunk).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
      out.push(`${i.toString(16).padStart(6, "0")}  ${hex}`);
    }
    return out.join("\n");
  }

  const displayText = $derived.by(() => {
    if (isBinary && !showAll) {
      return `Binary — ${bodyText.length} bytes. First 512 bytes:\n\n${hexHead(bodyText, 512)}`;
    }
    const source = isTooBig && !showAll ? bodyText.slice(0, HEAD_SLICE_BYTES) : bodyText;
    if (!isJson || !prettyOn) return source;
    try {
      return JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      return source;
    }
  });

  const tokens = $derived(isJson ? tokenize(displayText) : null);

  const lines = $derived(displayText.split("\n"));

  function copy() {
    navigator.clipboard?.writeText(displayText).catch(() => { /* best effort */ });
  }
</script>

<section class="raw">
  <header>
    <label>
      <input type="checkbox" bind:checked={prettyOn} disabled={!isJson} /> Pretty
    </label>
    <label>
      <input type="checkbox" bind:checked={lineNumbersOn} /> Line numbers
    </label>
    <span class="spacer"></span>
    <span class="meta">
      {isBinary ? "binary" : isJson ? "application/json" : (contentType ?? "plaintext")} · {formatBytes(bodyText.length)}
      {#if (isTooBig || isBinary) && !showAll}
        <button onclick={() => (showAll = true)}>
          Show all{isTooBig ? ` (${(bodyText.length / (1024*1024)).toFixed(2)} MB)` : ""}
        </button>
      {/if}
    </span>
    <button onclick={copy} aria-label="Copy body">Copy</button>
  </header>

  {#if lineNumbersOn}
    <div class="body with-gutter">
      <pre class="gutter">{lines.map((_, i) => i + 1).join("\n")}</pre>
      <pre class="text">{#if tokens}{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}{:else}{displayText}{/if}</pre>
    </div>
  {:else}
    <pre class="body text">{#if tokens}{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}{:else}{displayText}{/if}</pre>
  {/if}
</section>

<style>
  .raw {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--fg-dim);
    font-size: 11px;
  }
  header label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  header .spacer { flex: 1; }
  header .meta { color: var(--fg-dim); }
  header button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: 2px 8px;
    cursor: pointer;
  }
  header button:hover { color: var(--accent); border-color: var(--accent); }

  .body {
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    background: var(--bg);
    color: var(--fg);
    white-space: pre;
    flex: 1;
  }
  .with-gutter {
    display: grid;
    grid-template-columns: auto 1fr;
  }
  .gutter {
    color: var(--fg-dim);
    user-select: none;
    padding-right: var(--space-3);
    border-right: 1px solid var(--border);
    margin: 0;
    margin-right: var(--space-3);
  }
  .text { margin: 0; padding: 0; }

  /* Theme-aware token colours. */
  :global(.tk-key)    { color: var(--accent); }
  :global(.tk-string) { color: var(--fg); }
  :global(.tk-number) { color: color-mix(in srgb, var(--accent) 60%, var(--fg) 40%); }
  :global(.tk-bool)   { color: color-mix(in srgb, var(--accent) 50%, var(--fg) 50%); }
  :global(.tk-null)   { color: var(--fg-dim); }
  :global(.tk-punct)  { color: var(--fg-dim); }
  :global(.tk-raw)    { color: var(--fg); }
  :global(.tk-ws)     { white-space: pre; }
</style>
