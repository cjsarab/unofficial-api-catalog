<script lang="ts">
  // No props.
</script>

<section class="empty">
  <div class="label">Response</div>
  <p>Send a request to see the response here.</p>
  <p class="hint"><kbd>F5</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send · <kbd>Ctrl</kbd>+<kbd>\</kbd> to collapse this panel</p>
</section>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-dim);
    font-family: var(--font-mono);
    padding: var(--space-4);
    gap: var(--space-2);
    text-align: center;
  }
  .label {
    color: var(--fg-dim);
    font-size: var(--fs-sm);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  p { margin: 0; font-size: var(--fs-base); }
  .hint { font-size: var(--fs-sm); color: var(--fg-dim); }
  kbd {
    font: inherit;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 1px var(--space-1-5);
    font-size: 10.5px;
  }
</style>
