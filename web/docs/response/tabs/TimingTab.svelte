<script lang="ts">
  import type { ResponseTimings, ResponseBytes } from "../types.ts";

  type Props = {
    timings: ResponseTimings;
    bytes: ResponseBytes;
  };
  let { timings, bytes }: Props = $props();

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  const maxMs = $derived(
    Math.max(timings.authMs, timings.requestMs, timings.responseMs, timings.totalMs, 1),
  );

  type Phase = { label: string; ms: number; kind: string };
  const phases = $derived<Phase[]>([
    { label: "Auth", ms: timings.authMs, kind: "auth" },
    { label: "Request", ms: timings.requestMs, kind: "request" },
    { label: "Response", ms: timings.responseMs, kind: "response" },
    { label: "Total", ms: timings.totalMs, kind: "total" },
  ]);
</script>

<section class="timing">
  <div class="bars">
    {#each phases as phase}
      <div class="row">
        <span class="name">{phase.label}</span>
        <div class="track">
          <div class="bar kind-{phase.kind}" style="width: {(phase.ms / maxMs) * 100}%"></div>
        </div>
        <span class="ms">{phase.ms} ms</span>
      </div>
    {/each}
  </div>
  <div class="bytes">
    req: {formatBytes(bytes.requestBytes)} · resp: {formatBytes(bytes.responseBytes)}
  </div>
</section>

<style>
  .timing {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .bars { display: flex; flex-direction: column; gap: var(--space-2); }
  .row {
    display: grid;
    grid-template-columns: 80px 1fr 70px;
    align-items: center;
    gap: var(--space-3);
  }
  .name { color: var(--fg-dim); }
  .track {
    height: 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 180ms ease;
  }
  .bar.kind-auth     { background: color-mix(in srgb, var(--accent) 70%, var(--fg-dim) 30%); }
  .bar.kind-request  { background: var(--accent); }
  .bar.kind-response { background: color-mix(in srgb, var(--accent) 85%, var(--fg) 15%); }
  .bar.kind-total    { background: var(--fg-dim); opacity: 0.6; }
  .ms { color: var(--fg); text-align: right; }
  .bytes { color: var(--fg-dim); font-size: 11px; }
</style>
