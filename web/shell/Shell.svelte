<script lang="ts">
  import type { Snippet } from "svelte";
  import Splitter from "./Splitter.svelte";

  type Props = {
    topBar: Snippet;
    left: Snippet;
    middle: Snippet;
    right: Snippet;
    response: Snippet;
    statusBar: Snippet;
    onclearResponse?: () => void;
  };
  let { topBar, left, middle, right, response, statusBar, onclearResponse }: Props = $props();

  // ---- layout state -----------------------------------------------------
  // Initial defaults; overridden from localStorage on mount.
  let leftWidth = $state(240);
  let rightWidth = $state(380);
  let responseHeight = $state(240);
  let showLeft = $state(true);
  let showRight = $state(true);
  let showResponse = $state(true);
  let readerMode = $state(false);

  const MIN_LEFT = 160;
  const MAX_LEFT = 480;
  const MIN_RIGHT = 260;
  const MAX_RIGHT = 640;
  const MIN_RESPONSE = 90;
  const MAX_RESPONSE_PCT = 0.75; // up to 75% of viewport height

  // ---- persist + restore layout -----------------------------------------
  type Persist = {
    leftWidth: number;
    rightWidth: number;
    responseHeight: number;
    showLeft: boolean;
    showRight: boolean;
    showResponse: boolean;
  };
  const STORAGE_KEY = "acx:layout:v1";

  let initialised = $state(false);

  function restore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const p = JSON.parse(saved) as Partial<Persist>;
      if (typeof p.leftWidth === "number") leftWidth = clamp(p.leftWidth, MIN_LEFT, MAX_LEFT);
      if (typeof p.rightWidth === "number") rightWidth = clamp(p.rightWidth, MIN_RIGHT, MAX_RIGHT);
      if (typeof p.responseHeight === "number") responseHeight = clamp(p.responseHeight, MIN_RESPONSE, window.innerHeight * MAX_RESPONSE_PCT);
      if (typeof p.showLeft === "boolean") showLeft = p.showLeft;
      if (typeof p.showRight === "boolean") showRight = p.showRight;
      if (typeof p.showResponse === "boolean") showResponse = p.showResponse;
    } catch {
      // ignore bad saved state
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function persistLater() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snapshot: Persist = {
        leftWidth, rightWidth, responseHeight, showLeft, showRight, showResponse,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }, 300);
  }

  function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  // ---- resize handlers --------------------------------------------------
  function resizeLeft(delta: number) {
    leftWidth = clamp(leftWidth + delta, MIN_LEFT, MAX_LEFT);
    persistLater();
  }
  function resizeRight(delta: number) {
    // Dragging this splitter rightward should SHRINK the right pane,
    // because the right pane is anchored to the viewport edge.
    rightWidth = clamp(rightWidth - delta, MIN_RIGHT, MAX_RIGHT);
    persistLater();
  }
  function resizeResponse(delta: number) {
    // Splitter is horizontal; dragging up grows response pane.
    const maxResponse = window.innerHeight * MAX_RESPONSE_PCT;
    responseHeight = clamp(responseHeight - delta, MIN_RESPONSE, maxResponse);
    persistLater();
  }

  // ---- keyboard shortcuts -----------------------------------------------
  function onKey(e: KeyboardEvent) {
    // Ignore key combos inside text inputs so typing isn't hijacked.
    const t = e.target as HTMLElement | null;
    const isTypingTarget =
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable);

    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      if (e.key === "b" || e.key === "B") {
        showLeft = !showLeft;
        e.preventDefault();
        persistLater();
      } else if (e.key === "." ) {
        showRight = !showRight;
        e.preventDefault();
        persistLater();
      } else if (e.key === "\\") {
        showResponse = !showResponse;
        e.preventDefault();
        persistLater();
      }
    }
    if (!isTypingTarget && e.key === "F1") {
      e.preventDefault();
      helpOpen = !helpOpen;
    }
  }

  // ---- reader mode: temporarily hide side panels -----------------------
  let priorState: Pick<Persist, "showLeft" | "showRight" | "showResponse"> | null = null;
  function toggleReader() {
    if (readerMode) {
      if (priorState) {
        showLeft = priorState.showLeft;
        showRight = priorState.showRight;
        showResponse = priorState.showResponse;
      }
      priorState = null;
      readerMode = false;
    } else {
      priorState = { showLeft, showRight, showResponse };
      showLeft = false;
      showRight = false;
      showResponse = false;
      readerMode = true;
    }
    persistLater();
  }

  // ---- help overlay -----------------------------------------------------
  let helpOpen = $state(false);

  // ---- mount ------------------------------------------------------------
  $effect(() => {
    if (!initialised) {
      restore();
      initialised = true;
    }
  });

  // ---- derived grid template --------------------------------------------
  const leftCol = $derived(showLeft ? `${leftWidth}px` : "0px");
  const rightCol = $derived(showRight ? `${rightWidth}px` : "0px");
  const responseRow = $derived(showResponse ? `${responseHeight}px` : "0px");
</script>

<svelte:window onkeydown={onKey} />

<div
  class="shell"
  class:reader={readerMode}
  style="
    grid-template-columns: {leftCol} 4px minmax(0, 1fr) 4px {rightCol};
    grid-template-rows: auto minmax(0, 1fr) 4px {responseRow} auto;
  "
>
  <div class="top">{@render topBar()}</div>

  <aside class="pane pane-left" class:collapsed={!showLeft} aria-hidden={!showLeft}>
    {@render left()}
  </aside>
  {#if showLeft}
    <Splitter orientation="vertical" onresize={resizeLeft} ariaLabel="resize left sidebar" />
  {:else}
    <div class="splitter-placeholder"></div>
  {/if}

  <main class="pane pane-middle">{@render middle()}</main>

  {#if showRight}
    <Splitter orientation="vertical" onresize={resizeRight} ariaLabel="resize right panel" />
  {:else}
    <div class="splitter-placeholder"></div>
  {/if}
  <aside class="pane pane-right" class:collapsed={!showRight} aria-hidden={!showRight}>
    {@render right()}
  </aside>

  {#if showResponse}
    <Splitter orientation="horizontal" onresize={resizeResponse} ariaLabel="resize response panel" />
  {:else}
    <div class="splitter-placeholder horizontal"></div>
  {/if}
  <section class="pane pane-response" class:collapsed={!showResponse} aria-hidden={!showResponse}>
    {@render response()}
  </section>

  <div class="status">{@render statusBar()}</div>
</div>

{#if helpOpen}
  <div class="help-overlay" onclick={() => (helpOpen = false)} role="button" aria-label="close help">
    <div class="help-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="keyboard shortcuts">
      <div class="label">Keyboard shortcuts</div>
      <dl>
        <dt>F5</dt><dd>Send request <span class="dim">(not yet wired)</span></dd>
        <dt>Ctrl+Enter</dt><dd>Send request</dd>
        <dt>Ctrl+K</dt><dd>Command palette &amp; search</dd>
        <dt>Ctrl+B</dt><dd>Toggle left sidebar</dd>
        <dt>Ctrl+.</dt><dd>Toggle right (Try) panel</dd>
        <dt>Ctrl+\</dt><dd>Toggle response panel</dd>
        <dt>F1</dt><dd>Show / hide this help</dd>
      </dl>
      <button onclick={toggleReader}>{readerMode ? "Exit reader mode" : "Reader mode (hide side panels)"}</button>
    </div>
  </div>
{/if}

<style>
  .shell {
    display: grid;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--bg);
    color: var(--fg);
    grid-template-areas:
      "top    top  top    top  top"
      "left   sl   mid    sr   right"
      "hs     hs   hs     hs   hs"
      "resp   resp resp   resp resp"
      "status status status status status";
  }
  .top { grid-area: top; }
  .pane-left { grid-area: left; }
  .pane-middle { grid-area: mid; }
  .pane-right { grid-area: right; }
  .pane-response { grid-area: resp; }
  .status { grid-area: status; }

  .pane {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
  }
  .pane-left  { border-right: 1px solid var(--border); }
  .pane-right { border-left:  1px solid var(--border); }
  .pane-response { border-top: 1px solid var(--border); background: var(--bg-panel); }
  .pane.collapsed { display: none; }

  :global(.shell > :nth-child(3))  { grid-area: sl; }
  :global(.shell > :nth-child(5))  { grid-area: sr; }
  :global(.shell > :nth-child(7))  { grid-area: hs; }

  .splitter-placeholder {
    background: transparent;
  }
  .splitter-placeholder.horizontal { height: 4px; }

  /* Reader mode: docs takes the full middle + wider gutters */
  .shell.reader .pane-middle {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .help-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    display: grid;
    place-items: center;
    z-index: 100;
  }
  .help-card {
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    padding: var(--space-5) var(--space-6);
    max-width: 420px;
    font-size: 12px;
  }
  .help-card .label {
    color: var(--fg-dim);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: var(--space-3);
  }
  .help-card dl {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 4px var(--space-3);
    margin: 0 0 var(--space-4);
  }
  .help-card dt {
    font-family: var(--font-mono);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 1px 6px;
    text-align: center;
    font-size: 11px;
  }
  .help-card dd { margin: 0; align-self: center; color: var(--fg); }
  .help-card dd .dim { color: var(--fg-dim); font-size: 10.5px; }
  .help-card button {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: 5px 12px;
    cursor: pointer;
    width: 100%;
  }
  .help-card button:hover { color: var(--accent); border-color: var(--accent); }
</style>
