<script lang="ts">
  type Header = { name: string; value: string };

  type Props = {
    headers: Header[];
    onChange: (headers: Header[]) => void;
    /** Auto-computed Accept value from docs version dropdown. */
    autoAccept: string;
    /** True when the user clicked the Accept row to override the auto value. */
    acceptOverridden: boolean;
    onAcceptOverriddenChange: (next: boolean) => void;
  };
  let { headers, onChange, autoAccept, acceptOverridden, onAcceptOverriddenChange }: Props = $props();

  function updateHeader(i: number, patch: Partial<Header>) {
    onChange(headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }
  function removeHeader(i: number) {
    onChange(headers.filter((_, idx) => idx !== i));
  }
  function addHeader() {
    onChange([...headers, { name: "", value: "" }]);
  }
</script>

<div class="ht">
  <!-- Locked: Authorization (injected by proxy) -->
  <div class="ht-row locked">
    <span class="ht-locked-label">Authorization</span>
    <span class="ht-locked-value">Bearer … <em>(injected by server)</em></span>
  </div>

  <!-- Accept: auto or overridden -->
  {#if !acceptOverridden}
    <div class="ht-row locked">
      <span class="ht-locked-label">Accept</span>
      <span class="ht-locked-value">{autoAccept}</span>
      <button type="button" class="ht-auto" onclick={() => onAcceptOverriddenChange(true)} title="Click to override">auto</button>
    </div>
  {:else}
    <div class="ht-row">
      <input type="text" value="Accept" disabled class="ht-name" />
      <input type="text"
             value={headers.find((h) => h.name.toLowerCase() === "accept")?.value ?? autoAccept}
             oninput={(e) => {
               const val = (e.target as HTMLInputElement).value;
               const existing = headers.findIndex((h) => h.name.toLowerCase() === "accept");
               if (existing >= 0) updateHeader(existing, { value: val });
               else onChange([...headers, { name: "Accept", value: val }]);
             }}
             class="ht-value" />
      <button type="button" class="ht-x" onclick={() => { onAcceptOverriddenChange(false); onChange(headers.filter((h) => h.name.toLowerCase() !== "accept")); }}>revert</button>
    </div>
  {/if}

  <!-- User headers (excluding Accept if it's been folded into the locked row) -->
  {#each headers as h, i}
    {#if h.name.toLowerCase() !== "accept" || acceptOverridden}
      {#if !(h.name.toLowerCase() === "accept" && acceptOverridden)}
        <div class="ht-row">
          <input type="text" class="ht-name" value={h.name} oninput={(e) => updateHeader(i, { name: (e.target as HTMLInputElement).value })} placeholder="header name" />
          <input type="text" class="ht-value" value={h.value} oninput={(e) => updateHeader(i, { value: (e.target as HTMLInputElement).value })} placeholder="value" />
          <button type="button" class="ht-x" onclick={() => removeHeader(i)}>×</button>
        </div>
      {/if}
    {/if}
  {/each}

  <button type="button" class="ht-add" onclick={addHeader}>+ Add header</button>
</div>

<style>
  .ht { display: flex; flex-direction: column; gap: var(--space-1); }
  .ht-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: var(--space-1); align-items: center; }
  .ht-row.locked {
    background: var(--bg-panel); border: 1px solid var(--border);
    padding: 3px var(--space-1-5);
  }
  .ht-name, .ht-value {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); padding: 3px var(--space-1-5);
    font-family: inherit; font-size: var(--fs-base);
  }
  .ht-name:disabled { opacity: 0.6; }
  .ht-locked-label { color: var(--fg-dim); font-size: var(--fs-base); }
  .ht-locked-value { color: var(--fg-bright); font-size: var(--fs-base); overflow-wrap: anywhere; }
  .ht-auto {
    background: transparent; color: var(--fg-dim);
    border: 1px solid var(--border); padding: 1px 5px;
    font-family: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .ht-x { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); padding: 1px var(--space-1-5); cursor: pointer; }
  .ht-add {
    background: transparent; color: var(--fg-dim);
    border: 1px dashed var(--border); padding: 3px var(--space-1-5);
    font-family: inherit; cursor: pointer; align-self: flex-start;
  }
  .ht-add:hover { color: var(--fg); border-style: solid; }
</style>
