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
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: grid; place-items: center; z-index: 100;
  }
  .modal {
    background: var(--bg, #0d120d); color: var(--fg, #a9ff68);
    border: 1px solid var(--border-strong, #6ba544);
    padding: 16px; min-width: 440px; max-width: 640px;
    font-family: ui-monospace, monospace; font-size: 12px;
  }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  h3 { margin: 0; color: var(--fg-bright, #cfff9a); font-size: 14px; }
  .env { color: var(--fg-dim, #6ba544); display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .url-line { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
  .method { padding: 2px 6px; font-weight: bold; font-size: 11px; }
  .method-post { background: var(--method-post-bg); color: var(--method-post-fg); }
  .method-put { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-patch { background: var(--method-put-bg); color: var(--method-put-fg); }
  .method-delete { background: var(--method-delete-bg); color: var(--method-delete-fg); }
  .url { color: var(--fg-bright, #cfff9a); overflow-wrap: anywhere; }
  .body { background: var(--bg-panel, #0a100a); padding: 6px; border: 1px solid var(--border, #2a4a2a); max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .actions button { padding: 4px 12px; font-family: inherit; cursor: pointer; border: 1px solid var(--border, #2a4a2a); background: var(--bg, #0d120d); color: var(--fg, #a9ff68); }
  .actions .confirm { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger); }
</style>
