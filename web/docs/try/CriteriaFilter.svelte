<script lang="ts">
  import { scrapeCriteriaFilters, type ExtractedFilter } from "../../lib/criteria-scraper.ts";
  import type { OpenAPIParameter } from "../../lib/openapi.ts";

  type Props = {
    param: OpenAPIParameter;
    /** Current flattened criteria values keyed by rootKey → leafName. */
    value: Record<string, Record<string, string>>;
    onChange: (next: Record<string, Record<string, string>>) => void;
    /** Warnings from version migration: leafPaths the new version no longer documents. */
    undocumented?: Array<{ rootKey: string; leafPath: string }>;
  };
  let { param, value, onChange, undocumented = [] }: Props = $props();

  let mode = $state<"form" | "raw">("form");
  let pickerOpen = $state(false);
  let pickerQuery = $state("");
  let rawText = $state("");

  const filters = $derived.by<ExtractedFilter[]>(() =>
    scrapeCriteriaFilters(
      param.description ?? "",
      param.name,
      typeof param.example === "string" ? param.example : undefined,
    ),
  );
  const filtersByKey = $derived.by(() => {
    const m = new Map<string, ExtractedFilter>();
    for (const f of filters) m.set(`${f.rootKey}.${f.leafPath}`, f);
    return m;
  });
  const grouped = $derived.by(() => {
    const g = new Map<string, ExtractedFilter[]>();
    for (const f of filters) {
      const arr = g.get(f.rootKey) ?? [];
      arr.push(f);
      g.set(f.rootKey, arr);
    }
    return [...g.entries()];
  });

  const picked = $derived.by<Array<{ f: ExtractedFilter | null; rootKey: string; leafPath: string; val: string }>>(() => {
    const out: Array<{ f: ExtractedFilter | null; rootKey: string; leafPath: string; val: string }> = [];
    for (const [rk, leaves] of Object.entries(value)) {
      for (const [leaf, v] of Object.entries(leaves)) {
        const f = filtersByKey.get(`${rk}.${leaf}`) ?? null;
        out.push({ f, rootKey: rk, leafPath: leaf, val: v });
      }
    }
    return out;
  });

  // Match against the parent field name (root key) and the dotted full path
  // too, so typing a parent key like `credentials` surfaces its whole subtree
  // instead of returning empty. (QOL-002)
  const pickerVisible = $derived.by<Array<[string, ExtractedFilter[]]>>(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return grouped;
    return grouped
      .map(([root, list]) => {
        const rootMatch = root.toLowerCase().includes(q);
        const filtered = rootMatch
          ? list
          : list.filter(
              (f) =>
                f.label.toLowerCase().includes(q) ||
                f.leafPath.toLowerCase().includes(q) ||
                `${root}.${f.leafPath}`.toLowerCase().includes(q),
            );
        return [root, filtered] as [string, ExtractedFilter[]];
      })
      .filter(([, list]) => list.length > 0);
  });

  function isPicked(f: ExtractedFilter): boolean {
    return f.leafPath in (value[f.rootKey] ?? {});
  }

  function pick(f: ExtractedFilter) {
    if (isPicked(f)) return;
    onChange({
      ...value,
      [f.rootKey]: { ...(value[f.rootKey] ?? {}), [f.leafPath]: "" },
    });
    pickerOpen = false;
    pickerQuery = "";
  }

  function removeChip(rootKey: string, leafPath: string) {
    const inner = { ...(value[rootKey] ?? {}) };
    delete inner[leafPath];
    const next = { ...value };
    if (Object.keys(inner).length === 0) delete next[rootKey];
    else next[rootKey] = inner;
    onChange(next);
  }

  function setChipValue(rootKey: string, leafPath: string, v: string) {
    onChange({
      ...value,
      [rootKey]: { ...(value[rootKey] ?? {}), [leafPath]: v },
    });
  }

  const computedJson = $derived.by(() => {
    const obj: Record<string, unknown> = {};
    for (const [rk, leaves] of Object.entries(value)) {
      // Array-of-objects grouping: all same-root leaves in one object
      obj[rk] = [Object.fromEntries(Object.entries(leaves).map(([k, v]) => [k, v]))];
    }
    return JSON.stringify(obj, null, 2);
  });

  function switchMode(next: "form" | "raw") {
    if (mode === "form" && next === "raw") {
      rawText = computedJson;
    } else if (mode === "raw" && next === "form") {
      try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const nextValue: Record<string, Record<string, string>> = {};
        for (const [rk, v] of Object.entries(parsed)) {
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
            nextValue[rk] = Object.fromEntries(Object.entries(v[0] as Record<string, unknown>).map(([k, val]) => [k, String(val)]));
          } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            nextValue[rk] = { [rk]: String(v) };
          }
        }
        onChange(nextValue);
      } catch { /* ignore; user stays in raw */ }
    }
    mode = next;
  }

  const undocumentedKeys = $derived.by(() => new Set(undocumented.map((u) => `${u.rootKey}.${u.leafPath}`)));

  const setCount = $derived.by(() =>
    Object.values(value).reduce((n, leaves) => n + Object.keys(leaves).length, 0),
  );
</script>

<div class="cf">
  <div class="cf-head">
    <span class="cf-title">{param.name} <span class="cf-dim">({setCount} set)</span></span>
    <div class="cf-toggle">
      <button class="cf-mode" class:active={mode === "form"} onclick={() => switchMode("form")}>Form</button>
      <button class="cf-mode" class:active={mode === "raw"} onclick={() => switchMode("raw")}>Raw JSON</button>
    </div>
  </div>

  {#if mode === "form"}
    {#if picked.length > 0}
      <div class="cf-chips">
        {#each picked as p}
          {@const tag = undocumentedKeys.has(`${p.rootKey}.${p.leafPath}`)}
          <div class="cf-chip" class:undoc={tag}>
            <label>{p.f?.label ?? p.leafPath}{#if tag}<span class="cf-tag"> · no longer documented</span>{/if}</label>
            <input type="text" value={p.val} oninput={(e) => setChipValue(p.rootKey, p.leafPath, (e.target as HTMLInputElement).value)} />
            <button class="cf-x" onclick={() => removeChip(p.rootKey, p.leafPath)}>×</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if filters.length === 0}
      <div class="cf-empty">No filter shapes documented — use Raw JSON.</div>
    {:else}
      <div class="cf-picker">
        <button class="cf-add" onclick={() => (pickerOpen = !pickerOpen)}>
          + Add filter {pickerOpen ? "▴" : "▾"}
        </button>
        {#if pickerOpen}
          <div class="cf-dropdown">
            <input type="text" class="cf-search" placeholder="Search filters…" bind:value={pickerQuery} autofocus />
            {#each pickerVisible as [root, list]}
              <div class="cf-group">{root}</div>
              {#each list as f}
                {@const already = isPicked(f)}
                <div class="cf-opt" class:disabled={already} onclick={() => pick(f)} role="button" tabindex="0">
                  {f.label}{already ? " · already added" : ""}
                </div>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <textarea class="cf-raw" bind:value={rawText} rows={6}></textarea>
  {/if}
</div>

<style>
  .cf { display: flex; flex-direction: column; gap: 6px; }
  .cf-head { display: flex; justify-content: space-between; align-items: center; }
  .cf-title { color: var(--fg, #a9ff68); font-size: 12px; }
  .cf-dim { color: var(--fg-dim, #6ba544); }
  .cf-toggle { display: flex; gap: 2px; }
  .cf-mode {
    background: transparent; color: var(--fg-dim, #6ba544);
    border: 1px solid var(--border, #1e2a1e); padding: 1px 6px;
    font-family: inherit; cursor: pointer; font-size: 11px;
  }
  .cf-mode.active { background: var(--bg-panel, #152815); color: var(--fg, #a9ff68); border-color: var(--border-strong, #6ba544); }

  .cf-chips { display: flex; flex-direction: column; gap: 4px; }
  .cf-chip { display: grid; grid-template-columns: minmax(110px, max-content) 1fr auto; gap: 6px; align-items: center; }
  .cf-chip label { color: var(--fg-dim, #6ba544); font-size: 12px; }
  .cf-chip input {
    background: var(--bg, #0d120d); color: var(--fg, #a9ff68);
    border: 1px solid var(--border, #1e2a1e); padding: 3px 6px;
    font-family: inherit; font-size: 12px;
  }
  .cf-chip.undoc label { color: #d4a548; }
  .cf-tag { font-size: 10px; color: #a67c20; }
  .cf-x { background: transparent; color: var(--fg-dim, #6ba544); border: 1px solid var(--border, #1e2a1e); cursor: pointer; padding: 0 6px; }

  .cf-picker { position: relative; }
  .cf-add {
    background: var(--bg-panel, #152815); color: var(--fg-dim, #6ba544);
    border: 1px dashed var(--border, #2a4a2a); padding: 3px 6px;
    font-family: inherit; cursor: pointer; width: 100%; text-align: left;
  }
  .cf-add:hover { border-style: solid; color: var(--fg, #a9ff68); }
  .cf-dropdown {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 5;
    background: #0a100a; border: 1px solid var(--border-strong, #6ba544);
    padding: 6px; max-height: 280px; overflow-y: auto;
  }
  .cf-search {
    background: var(--bg, #0d120d); color: var(--fg, #a9ff68);
    border: 1px solid var(--border, #1e2a1e); padding: 3px 6px;
    font-family: inherit; width: 100%; margin-bottom: 6px;
  }
  .cf-group { color: var(--fg-dim, #6ba544); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 6px; }
  .cf-opt { padding: 2px 6px; color: var(--fg, #ccc); cursor: pointer; }
  .cf-opt:hover:not(.disabled) { background: var(--bg-panel, #152815); }
  .cf-opt.disabled { color: #555; text-decoration: line-through; cursor: not-allowed; }

  .cf-raw {
    background: var(--bg, #0d120d); color: var(--fg-bright, #cfff9a);
    border: 1px solid var(--border, #1e2a1e); padding: 6px;
    font-family: inherit; font-size: 11px; width: 100%; resize: vertical;
  }
  .cf-empty { color: var(--fg-dim, #6ba544); font-style: italic; font-size: 11px; }
</style>
