<script lang="ts">
  import type { OpenAPIParameter } from "../../lib/openapi.ts";
  import SchemaInput from "./SchemaInput.svelte";
  import CriteriaFilter from "./CriteriaFilter.svelte";

  type Props = {
    parameters: OpenAPIParameter[];
    pathValues: Record<string, string>;
    queryValues: Record<string, string>;
    criteriaValues: Record<string, Record<string, string>>;
    onPathChange: (name: string, v: string) => void;
    onQueryChange: (name: string, v: string) => void;
    onCriteriaChange: (v: Record<string, Record<string, string>>) => void;
    /** Fields required-but-empty as of the last Send attempt. */
    amberNames?: Set<string>;
    undocumentedCriteria?: Array<{ rootKey: string; leafPath: string }>;
  };
  let {
    parameters, pathValues, queryValues, criteriaValues,
    onPathChange, onQueryChange, onCriteriaChange,
    amberNames = new Set(), undocumentedCriteria = [],
  }: Props = $props();

  const pathParams = $derived(parameters.filter((p) => p.in === "path"));
  const queryParams = $derived(parameters.filter((p) => p.in === "query"));
  const criteriaParam = $derived(queryParams.find((p) => p.schema?.type === "object" && (p.description?.includes(`?${p.name}=`) || typeof p.example === "string")));
  const otherQueryParams = $derived(criteriaParam ? queryParams.filter((p) => p.name !== criteriaParam.name) : queryParams);

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
      {#if criteriaParam}
        <div class="pt-row pt-criteria">
          <CriteriaFilter
            param={criteriaParam}
            value={criteriaValues}
            onChange={onCriteriaChange}
            undocumented={undocumentedCriteria}
          />
        </div>
      {/if}
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
  .pt-type { color: #3d6927; font-size: 10px; }
  .pt-req { color: #d4a548; margin-left: 2px; align-self: flex-start; }
  .pt-criteria { display: block; }
  .empty { color: var(--fg-dim, #6ba544); font-style: italic; }
</style>
