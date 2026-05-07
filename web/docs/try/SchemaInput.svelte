<script lang="ts">
  import type { OpenAPISchema } from "../../lib/openapi.ts";
  // Self-reference (Svelte 5 requires the explicit import for recursion):
  import SchemaInput from "./SchemaInput.svelte";

  type Props = {
    schema: OpenAPISchema | undefined;
    value: unknown;
    onChange: (next: unknown) => void;
    /** Shown as red border + tooltip when true. */
    invalid?: boolean;
    /** Used as <input placeholder> for string controls. */
    placeholder?: string;
    /** For object/array — depth prevents runaway nesting (safety cap at 6). */
    depth?: number;
  };
  let { schema, value, onChange, invalid, placeholder, depth = 0 }: Props = $props();

  const MAX_DEPTH = 6;

  const dispatch = $derived.by(() => {
    if (!schema) return "text" as const;
    if (schema.oneOf || schema.allOf || schema.anyOf) return "raw" as const;
    if (schema.enum && schema.enum.length > 0) return "enum" as const;
    if (schema.type === "boolean") return "boolean" as const;
    if (schema.type === "integer" || schema.type === "number") return "number" as const;
    if (schema.type === "array") return "array" as const;
    if (schema.type === "object") {
      if (depth >= MAX_DEPTH) return "raw" as const;
      return "object" as const;
    }
    if (schema.type === "string") {
      if (schema.format === "date") return "date" as const;
      if (schema.format === "date-time") return "datetime" as const;
      if (schema.format === "uuid") return "uuid" as const;
      return "text" as const;
    }
    return "text" as const;
  });

  // UUID validation
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let uuidBlurred = $state(false);
  const uuidInvalid = $derived(
    dispatch === "uuid" &&
    uuidBlurred &&
    typeof value === "string" &&
    value.length > 0 &&
    !UUID_RE.test(value),
  );

  function asString(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  }

  function setFromInput(ev: Event) { onChange((ev.target as HTMLInputElement).value); }
  function setNumberFromInput(ev: Event) {
    const raw = (ev.target as HTMLInputElement).value;
    onChange(raw === "" ? "" : raw);
  }

  // Array helpers (for type:"array" of scalars — chips editor)
  let chipDraft = $state("");
  function addChip() {
    const v = chipDraft.trim();
    if (!v) return;
    const existing = Array.isArray(value) ? (value as string[]) : [];
    onChange([...existing, v]);
    chipDraft = "";
  }
  function removeChip(i: number) {
    const existing = Array.isArray(value) ? (value as string[]) : [];
    onChange(existing.filter((_, idx) => idx !== i));
  }
  function chipKeydown(ev: KeyboardEvent) {
    if (ev.key === "Enter") { ev.preventDefault(); addChip(); }
  }

  // Object mode: render each declared property recursively.
  const objectProps = $derived.by<Array<[string, OpenAPISchema, boolean]>>(() => {
    if (dispatch !== "object" || !schema?.properties) return [];
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([k, v]) => [k, v, required.has(k)] as [string, OpenAPISchema, boolean]);
  });

  function setObjectProp(key: string, next: unknown) {
    const existing = (typeof value === "object" && value !== null && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};
    onChange({ ...existing, [key]: next });
  }
</script>

{#if dispatch === "text"}
  <input type="text" class="si-input" class:invalid bind:value={() => asString(value), (v) => onChange(v)}
         {placeholder} />
{:else if dispatch === "enum"}
  <select class="si-select" class:invalid
          value={asString(value)}
          onchange={(e) => onChange((e.target as HTMLSelectElement).value)}>
    {#if !schema?.required}
      <option value="">—</option>
    {/if}
    {#each schema?.enum ?? [] as opt}
      <option value={String(opt)}>{String(opt)}</option>
    {/each}
  </select>
{:else if dispatch === "date"}
  <input type="date" class="si-input" class:invalid value={asString(value)} onchange={setFromInput} />
{:else if dispatch === "datetime"}
  <input type="datetime-local" class="si-input" class:invalid value={asString(value)} onchange={setFromInput} />
{:else if dispatch === "uuid"}
  <input type="text" class="si-input"
         class:invalid={invalid || uuidInvalid}
         value={asString(value)}
         placeholder={placeholder ?? "00000000-0000-0000-0000-000000000000"}
         oninput={setFromInput}
         onblur={() => (uuidBlurred = true)} />
{:else if dispatch === "number"}
  <input type="number" class="si-input" class:invalid
         value={asString(value)}
         min={schema?.minimum} max={schema?.maximum}
         oninput={setNumberFromInput} />
{:else if dispatch === "boolean"}
  <label class="si-bool">
    <input type="checkbox" checked={value === true || value === "true"}
           onchange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    <span>{value === true || value === "true" ? "true" : "false"}</span>
  </label>
{:else if dispatch === "array"}
  <div class="si-chips" class:invalid>
    {#if Array.isArray(value)}
      {#each value as chip, i}
        <span class="si-chip">{chip}<button type="button" class="si-chip-x" onclick={() => removeChip(i)}>×</button></span>
      {/each}
    {/if}
    <input class="si-chip-input" bind:value={chipDraft} onkeydown={chipKeydown}
           placeholder="type + Enter" />
  </div>
{:else if dispatch === "object"}
  <div class="si-obj">
    {#each objectProps as [key, sub, req]}
      <div class="si-obj-row">
        <label class="si-obj-label">{key}{#if req}<span class="si-required">*</span>{/if}
          <span class="si-obj-type">{sub.type ?? "any"}{sub.format ? " · " + sub.format : ""}</span>
        </label>
        <SchemaInput
          schema={sub}
          value={(typeof value === "object" && value !== null && !Array.isArray(value)) ? (value as Record<string, unknown>)[key] : undefined}
          onChange={(v) => setObjectProp(key, v)}
          depth={depth + 1}
        />
      </div>
    {/each}
  </div>
{:else}
  <!-- raw fallback -->
  <textarea class="si-raw" class:invalid
            value={asString(value) || "{}"}
            oninput={setFromInput}
            rows={4}></textarea>
{/if}

<style>
  .si-input, .si-select, .si-raw {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-1-5);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: var(--fs-base);
    width: 100%;
  }
  .si-input:focus, .si-select:focus, .si-raw:focus { outline: 1px solid var(--border-strong); }
  .invalid { border-color: var(--danger-border) !important; color: var(--danger); }
  /* Inherit color-scheme from :root (set per-theme in theme.css) so date
     pickers blend on both dark and beige themes. */

  .si-bool { display: flex; align-items: center; gap: var(--space-1-5); color: var(--fg); cursor: pointer; }
  .si-bool input { accent-color: var(--border-strong); }

  .si-chips {
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 3px;
    display: flex; flex-wrap: wrap; gap: 3px; align-items: center;
  }
  .si-chip {
    background: var(--bg-panel);
    color: var(--fg-bright);
    padding: var(--space-0) var(--space-1-5); border: 1px solid var(--border);
  }
  .si-chip-x { background: transparent; border: none; color: var(--fg-dim); cursor: pointer; margin-left: var(--space-1); padding: 0; }
  .si-chip-input {
    background: transparent; border: none; color: var(--fg);
    font-family: inherit; outline: none; padding: var(--space-0) var(--space-1); flex: 1; min-width: 60px;
  }

  .si-obj { padding-left: var(--space-2); border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: var(--space-1); }
  .si-obj-row { display: grid; grid-template-columns: minmax(110px, max-content) 1fr; gap: var(--space-1-5); align-items: center; }
  .si-obj-label { color: var(--fg-dim); font-size: var(--fs-base); display: flex; flex-direction: column; }
  .si-obj-type { color: var(--fg-dim); font-size: var(--fs-xs); }
  .si-required { color: var(--warn); margin-left: var(--space-0); }

  .si-raw { min-height: 48px; resize: vertical; }
</style>
