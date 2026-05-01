<script lang="ts">
  type Props = {
    envName: string;
    region: string;
    method: string;
    url: string;
    bodyPreview: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  let { envName, region, method, url, bodyPreview, onConfirm, onCancel }: Props = $props();

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter")  { e.preventDefault(); onConfirm(); }
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="modal-backdrop" onclick={onCancel} role="dialog" aria-modal="true">
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <header>
      <h3>Confirm production send</h3>
      <span class="env"><span class="dot"></span>{envName} · {region.toUpperCase()}</span>
    </header>
    <div class="url-line">
      <span class="method method-{method.toLowerCase()}">{method}</span>
      <code class="url">{url}</code>
    </div>
    {#if bodyPreview}
      <pre class="body">{bodyPreview}</pre>
    {/if}
    <div class="actions">
      <button class="cancel" onclick={onCancel}>Cancel (Esc)</button>
      <button class="confirm" onclick={onConfirm}>Send (Enter)</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: var(--overlay-bg);
    display: grid; place-items: center; z-index: 100;
  }
  .modal {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border-strong);
    padding: var(--space-4); min-width: 440px; max-width: 640px;
    font-family: ui-monospace, monospace; font-size: var(--fs-base);
  }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2-5); }
  h3 { margin: 0; color: var(--fg-bright); font-size: var(--fs-md); }
  .env { color: var(--fg-dim); display: flex; align-items: center; gap: var(--space-1-5); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .url-line { display: flex; gap: var(--space-1-5); align-items: center; margin-bottom: var(--space-2); }
  .method { padding: var(--space-0) var(--space-1-5); font-weight: bold; font-size: var(--fs-sm); }
  .method-post { background: var(--method-post-bg); color: var(--method-post-fg); }
  .method-put { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-patch { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .url { color: var(--fg-bright); overflow-wrap: anywhere; }
  .body { background: var(--bg-panel); padding: var(--space-1-5); border: 1px solid var(--border); max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  .actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
  .actions button { padding: var(--space-1) var(--space-3); font-family: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
  .actions .confirm { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger); }
</style>
