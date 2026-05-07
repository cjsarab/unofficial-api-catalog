<script lang="ts">
  type Props = { catalogPath?: string };
  let { catalogPath }: Props = $props();
</script>

<section class="catalog-panel">
  <header><h2>Catalog</h2></header>

  <div class="current">
    <h3>Current path</h3>
    {#if catalogPath}
      <code class="path">{catalogPath}</code>
    {:else}
      <p class="muted">No catalog configured.</p>
    {/if}
  </div>

  <div class="placeholder">
    <p>Changing the catalog path, re-scanning, and browsing for a new folder are handled by the existing first-run wizard. Inline controls here are a later enhancement.</p>
  </div>
</section>

<style>
  .catalog-panel { display: flex; flex-direction: column; gap: var(--space-5); }
  .catalog-panel h2 { font-size: 1.1rem; margin: 0; color: var(--fg); }
  .current { display: flex; flex-direction: column; gap: var(--space-2); }
  .current h3 { font-size: 0.95rem; margin: 0; color: var(--fg-dim); font-weight: 600; }
  .path {
    background: var(--bg);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    color: var(--fg);
    word-break: break-all;
  }
  .muted { color: var(--fg-dim); margin: 0; }
  .placeholder p { color: var(--fg-dim); font-size: 0.9rem; margin: 0; }
</style>
