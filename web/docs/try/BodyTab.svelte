<script lang="ts">
  import type { OpenAPIRequestBody, OpenAPISchema } from "../../lib/openapi.ts";
  import { isJsonContentType } from "../response/format.ts";
  import { buildSkeleton } from "./build-skeleton.ts";
  import SchemaInput from "./SchemaInput.svelte";

  type Props = {
    method: string;
    requestBody: OpenAPIRequestBody | null;
    mode: "form" | "raw";
    onModeChange: (m: "form" | "raw") => void;
    text: string;
    onTextChange: (t: string) => void;
    /** Parsed form value when mode === "form". */
    formValue: unknown;
    onFormValueChange: (v: unknown) => void;
  };
  let {
    method, requestBody, mode, onModeChange, text, onTextChange,
    formValue, onFormValueChange,
  }: Props = $props();

  const noBody = $derived(["GET", "HEAD", "DELETE"].includes(method.toUpperCase()));
  // Pick the first JSON-like media type. Ellucian uses vendor variants like
  // `application/vnd.hedtech.integration.v1.0.0+json`, so a literal
  // `application/json` lookup misses every Bus/EEDM PUT/POST.
  const jsonEntry = $derived.by(() => {
    const content = requestBody?.content;
    if (!content) return undefined;
    const ct = Object.keys(content).find(isJsonContentType);
    return ct ? content[ct] : undefined;
  });
  const schema = $derived<OpenAPISchema | undefined>(jsonEntry?.schema);
  const example = $derived<unknown>(jsonEntry?.example ?? jsonEntry?.schema?.example);
  const prefillLabel = $derived<string | null>(
    example !== undefined ? "↓ Insert example" : schema ? "↓ Insert skeleton" : null,
  );

  function prefill() {
    if (example !== undefined) {
      onTextChange(JSON.stringify(example, null, 2));
      return;
    }
    if (schema) {
      onTextChange(JSON.stringify(buildSkeleton(schema), null, 2));
    }
  }
</script>

{#if noBody}
  <p class="empty">(no body for {method.toUpperCase()} requests)</p>
{:else}
  <div class="bt-head">
    <div class="bt-toggle">
      <button class="bt-mode" class:active={mode === "form"} onclick={() => onModeChange("form")}>Form</button>
      <button class="bt-mode" class:active={mode === "raw"} onclick={() => onModeChange("raw")}>Raw JSON</button>
    </div>
    {#if mode === "raw" && prefillLabel}
      <button class="bt-prefill" onclick={prefill}>{prefillLabel}</button>
    {/if}
  </div>

  {#if mode === "raw"}
    <textarea class="bt-raw" value={text} oninput={(e) => onTextChange((e.target as HTMLTextAreaElement).value)} rows={12} spellcheck="false"></textarea>
  {:else}
    {#if schema}
      <SchemaInput schema={schema} value={formValue} onChange={onFormValueChange} />
    {:else}
      <p class="empty">(no schema for this request body — use Raw JSON)</p>
    {/if}
  {/if}
{/if}

<style>
  .bt-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-1-5); }
  .bt-toggle { display: flex; gap: var(--space-0); }
  .bt-mode {
    background: transparent; color: var(--fg-dim);
    border: 1px solid var(--border); padding: var(--space-0) var(--space-2);
    font-family: inherit; cursor: pointer; font-size: var(--fs-sm);
  }
  .bt-mode.active { background: var(--bg-panel); color: var(--fg); border-color: var(--border-strong); }
  .bt-prefill {
    background: transparent; color: var(--fg);
    border: 1px solid var(--border); padding: var(--space-0) var(--space-2);
    font-family: inherit; cursor: pointer; font-size: var(--fs-sm);
  }
  .bt-prefill:disabled { opacity: 0.4; cursor: not-allowed; }
  .bt-raw {
    background: var(--bg); color: var(--fg-bright);
    border: 1px solid var(--border); padding: var(--space-1-5);
    font-family: ui-monospace, monospace; font-size: var(--fs-sm);
    width: 100%; resize: vertical; min-height: 200px;
  }
  .empty { color: var(--fg-dim); font-style: italic; }
</style>
