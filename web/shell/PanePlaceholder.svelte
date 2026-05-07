<script lang="ts">
  type Props = {
    title: string;
    description?: string;
    taskNumber?: number;
  };
  let { title, description, taskNumber }: Props = $props();
</script>

<div class="placeholder">
  <div class="label">{title}</div>
  {#if description}
    <p>{description}</p>
  {/if}
  {#if taskNumber !== undefined}
    <p class="task">arrives in Task {taskNumber}</p>
  {/if}
</div>

<style>
  .placeholder {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    color: var(--fg-dim);
    text-align: center;
  }
  .label {
    color: var(--fg);
    font-size: var(--fs-sm);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: var(--space-2);
  }
  p {
    margin: var(--space-0) 0;
    font-size: var(--fs-base);
    max-width: 36ch;
    line-height: 1.4;
  }
  p.task {
    margin-top: var(--space-2);
    font-size: var(--fs-xs);
    opacity: 0.65;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
