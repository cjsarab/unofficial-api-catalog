<script lang="ts">
  import type { OpenAPIRequestBody, OpenAPISchema } from "../../lib/openapi.ts";
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
  const schema = $derived<OpenAPISchema | undefined>(requestBody?.content?.["application/json"]?.schema);

  function prefillSkeleton() {
    if (!schema) { onTextChange("{}"); return; }
    const skel = buildSkeleton(schema);
    onTextChange(JSON.stringify(skel, null, 2));
  }

  function buildSkeleton(s: OpenAPISchema): unknown {
    if (s.default !== undefined) return s.default;
    if (s.enum && s.enum.length > 0) return s.enum[0];
    if (s.type === "string") {
      if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (s.format === "date") return "2026-01-01";
      if (s.format === "date-time") return "2026-01-01T00:00:00Z";
      return "";
    }
    if (s.type === "integer" || s.type === "number") return s.minimum ?? 0;
    if (s.type === "boolean") return false;
    if (s.type === "array") return s.items ? [buildSkeleton(s.items)] : [];
    if (s.type === "object" && s.properties) {
      const required = new Set(s.required ?? []);
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(s.properties)) {
        if (required.has(k)) out[k] = buildSkeleton(sub);
      }
      return out;
    }
    return null;
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
    {#if mode === "raw"}
      <button class="bt-prefill" onclick={prefillSkeleton} disabled={!schema}>↓ Prefill from schema</button>
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
