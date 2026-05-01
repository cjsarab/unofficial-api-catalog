<script lang="ts">
  import { tokenize } from "../highlight.ts";
  import { formatBytes, isJsonContentType } from "../format.ts";
  import JsonTree from "../JsonTree.svelte";
  import type { Json } from "../types.ts";

  type Props = {
    bodyText: string;
    contentType: string | null;
  };
  let { bodyText, contentType }: Props = $props();

  const HEAD_SLICE_BYTES = 64 * 1024;
  const HEAD_THRESHOLD_BYTES = 1024 * 1024;
  // Tokenize (syntax-highlight) cap. The original 200KB was overly tight
  // — typical /api/persons responses (~50 records, ~5KB each) sat at
  // 250-500KB and lost both highlighting and Pretty as a side-effect.
  // 1MB is fine for an O(n) text walk on modern browsers.
  const TOKENIZE_MAX_BYTES = 1024 * 1024;

  let showAll = $state(false);

  const isJson = $derived(isJsonContentType(contentType));
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

  const tokensTooBig = $derived(isJson && bodyText.length > TOKENIZE_MAX_BYTES);

  const parsedJson = $derived.by<Json | null>(() => {
    if (!isJson) return null;
    try { return JSON.parse(bodyText) as Json; } catch { return null; }
  });

  const treeAvailable = $derived(isJson && !tokensTooBig && parsedJson !== null);

  const displayText = $derived.by(() => {
    if (isBinary && !showAll) {
      return `Binary — ${bodyText.length} bytes. First 512 bytes:\n\n${hexHead(bodyText, 512)}`;
    }
    const source = isTooBig && !showAll ? bodyText.slice(0, HEAD_SLICE_BYTES) : bodyText;
    // Always pretty-print JSON in the flat-text fallback (head-sliced or
    // unparseable bodies). JSON.stringify is fast even at multi-MB, and the
    // tree handles every other case. If `source` is a truncated head-slice,
    // the parse below throws and we fall back to the raw slice.
    if (!isJson) return source;
    try {
      return JSON.stringify(JSON.parse(source), null, 2);
    } catch {
      return source;
    }
  });

  const tokens = $derived(isJson && !tokensTooBig ? tokenize(displayText) : null);

  function copy() {
    navigator.clipboard?.writeText(displayText).catch(() => { /* best effort */ });
  }
</script>

<section class="raw">
  <header>
    {#if tokensTooBig}
      <span class="note" title="Highlighting disabled to keep the panel responsive on large bodies.">highlighting off (large body)</span>
    {/if}
    <span class="spacer"></span>
    <span class="meta">
      {isBinary ? "binary" : (contentType ?? (isJson ? "application/json" : "plaintext"))} · {formatBytes(bodyText.length)}
      {#if (isTooBig || isBinary) && !showAll}
        <button onclick={() => (showAll = true)}>
          Show all{isTooBig ? ` (${(bodyText.length / (1024*1024)).toFixed(2)} MB)` : ""}
        </button>
      {/if}
    </span>
    <button onclick={copy} aria-label="Copy body">Copy</button>
  </header>

  {#if treeAvailable}
    <div class="body tree">
      <JsonTree value={parsedJson as Json} />
    </div>
  {:else}
    <div class="body">
      <pre class="text">{#if tokens}{#each tokens as t}<span class="tk-{t.kind}">{t.text}</span>{/each}{:else}{displayText}{/if}</pre>
    </div>
  {/if}
</section>

<style>
  .raw {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-base);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--fg-dim);
    font-size: var(--fs-sm);
  }
  header .spacer { flex: 1; }
  header .meta { color: var(--fg-dim); }
  header .note { color: var(--fg-dim); font-size: var(--fs-xs); }
  header button {
    font: inherit;
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid var(--border);
    padding: var(--space-0) var(--space-2);
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
  .body.tree {
    padding: var(--space-3);
    overflow: auto;
    background: var(--bg);
    flex: 1;
    white-space: normal;
  }
  .text { margin: 0; padding: 0; }
  /* JSON syntax-highlight token colours live in web/styles/json-syntax.css */
</style>
