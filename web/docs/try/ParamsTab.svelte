<script lang="ts">
  import type { OpenAPIParameter } from "../../lib/openapi.ts";
  import SchemaInput from "./SchemaInput.svelte";
  import CriteriaFilter from "./CriteriaFilter.svelte";
  import { isCriteriaParam } from "./version-migration.ts";

  type Props = {
    parameters: OpenAPIParameter[];
    pathValues: Record<string, string>;
    queryValues: Record<string, string>;
    /** Per-param criteria values: paramName → rootKey → leafName → value. */
    criteriaValues: Record<string, Record<string, Record<string, string>>>;
    /** Per-param raw-mode literal text override. */
    criteriaRaw?: Record<string, string>;
    onPathChange: (name: string, v: string) => void;
    onQueryChange: (name: string, v: string) => void;
    onCriteriaChange: (paramName: string, v: Record<string, Record<string, string>>) => void;
    onCriteriaRawChange: (paramName: string, raw: string | null) => void;
    /** Fields required-but-empty as of the last Send attempt. */
    amberNames?: Set<string>;
    undocumentedCriteria?: Array<{ paramName: string; rootKey: string; leafPath: string }>;
  };
  let {
    parameters, pathValues, queryValues, criteriaValues, criteriaRaw,
    onPathChange, onQueryChange, onCriteriaChange, onCriteriaRawChange,
    amberNames = new Set(), undocumentedCriteria = [],
  }: Props = $props();

  const pathParams = $derived(parameters.filter((p) => p.in === "path"));
  const queryParams = $derived(parameters.filter((p) => p.in === "query"));
  const criteriaParams = $derived(queryParams.filter(isCriteriaParam));
  const criteriaNameSet = $derived(new Set(criteriaParams.map((p) => p.name)));
  const otherQueryParams = $derived(queryParams.filter((p) => !criteriaNameSet.has(p.name)));

  const noParams = $derived(pathParams.length === 0 && queryParams.length === 0);
</script>

{#if noParams}
  <p class="empty">(this endpoint takes no parameters)</p>
{:else}
  {#if pathParams.length > 0}
    <section class="pt-section">
      <h4>Path parameters</h4>
      {#each pathParams as p}
        <div class="pt-row">
          <label>{p.name}<span class="pt-type">{p.schema?.type ?? "string"}{p.schema?.format ? " · " + p.schema.format : ""}</span><span class="pt-req">*</span></label>
          <SchemaInput
            schema={p.schema}
            value={pathValues[p.name] ?? ""}
            onChange={(v) => onPathChange(p.name, typeof v === "string" ? v : String(v ?? ""))}
            invalid={amberNames.has(p.name)}
          />
        </div>
      {/each}
    </section>
  {/if}

  {#if queryParams.length > 0}
    <section class="pt-section">
      <h4>Query parameters</h4>
      {#each otherQueryParams as p}
        <div class="pt-row">
          <label>{p.name}<span class="pt-type">{p.schema?.type ?? "string"}{p.schema?.format ? " · " + p.schema.format : ""}</span>{#if p.required}<span class="pt-req">*</span>{/if}</label>
          <SchemaInput
            schema={p.schema}
            value={queryValues[p.name] ?? ""}
            onChange={(v) => onQueryChange(p.name, typeof v === "string" ? v : String(v ?? ""))}
            invalid={amberNames.has(p.name)}
          />
        </div>
      {/each}
      {#each criteriaParams as cp (cp.name)}
        <div class="pt-row pt-criteria">
          <CriteriaFilter
            param={cp}
            value={criteriaValues[cp.name] ?? {}}
            onChange={(v) => onCriteriaChange(cp.name, v)}
            rawOverride={criteriaRaw?.[cp.name]}
            onRawOverride={(raw) => onCriteriaRawChange(cp.name, raw)}
            undocumented={undocumentedCriteria.filter((u) => u.paramName === cp.name)}
          />
        </div>
      {/each}
    </section>
  {/if}
{/if}

<style>
  .pt-section { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  h4 {
    color: var(--fg, #8fe68f); border-bottom: 1px solid var(--border, #2a4a2a);
    padding-bottom: 2px; margin: 0 0 4px 0; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.05em; font-weight: normal;
  }
  .pt-row { display: grid; grid-template-columns: minmax(110px, max-content) 1fr; gap: 6px; align-items: start; }
  .pt-row label { color: var(--fg-dim, #6ba544); font-size: 12px; display: flex; flex-direction: column; padding-top: 4px; }
  .pt-type { color: var(--fg-dim); font-size: 10px; }
  .pt-req { color: var(--warn); margin-left: 2px; align-self: flex-start; }
  .pt-criteria { display: block; }
  .empty { color: var(--fg-dim, #6ba544); font-style: italic; }
</style>
