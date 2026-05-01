<script lang="ts">
  import { scrapeCriteriaFilters, inferRootShapes, type ExtractedFilter, type RootShape } from "../../lib/criteria-scraper.ts";
  import type { OpenAPIParameter } from "../../lib/openapi.ts";

  type Props = {
    param: OpenAPIParameter;
    /** Current flattened criteria values keyed by rootKey → leafName. */
    value: Record<string, Record<string, string>>;
    onChange: (next: Record<string, Record<string, string>>) => void;
    /** Raw-mode literal text override for this param (set when the user typed
     *  custom JSON whose shape can't be reconstructed from chips alone). */
    rawOverride?: string;
    onRawOverride: (raw: string | null) => void;
    /** Warnings from version migration: leafPaths the new version no longer documents. */
    undocumented?: Array<{ rootKey: string; leafPath: string }>;
  };
  let { param, value, onChange, rawOverride, onRawOverride, undocumented = [] }: Props = $props();

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

  // Shape per rootKey from the description-scrape — used to render computedJson
  // in the wire shape the API expects (scalar / object / array-of-objects),
  // and as a fallback when the user's typed JSON looks ambiguous.
  const shapes = $derived(inferRootShapes(filters));

  function pick(f: ExtractedFilter) {
    if (isPicked(f)) return;
    onChange({
      ...value,
      [f.rootKey]: { ...(value[f.rootKey] ?? {}), [f.leafPath]: "" },
    });
    onRawOverride(null); // form-mode edit — chips become canonical
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
    onRawOverride(null);
  }

  function setChipValue(rootKey: string, leafPath: string, v: string) {
    onChange({
      ...value,
      [rootKey]: { ...(value[rootKey] ?? {}), [leafPath]: v },
    });
    onRawOverride(null);
  }

  /** Wrap leaves into the wire shape declared for this rootKey. Default for
   *  unknown shapes is an unwrapped object (preserves user intent better than
   *  blindly wrapping in `[…]`). */
  function shapeLeaves(rk: string, leaves: Record<string, string>): unknown {
    const filled = Object.entries(leaves).filter(([, v]) => v !== "");
    if (filled.length === 0) return undefined;
    const shape: RootShape | undefined = shapes.get(rk);
    if (shape === "scalar" && filled.length === 1 && filled[0]![0] === rk) {
      return filled[0]![1];
    }
    if (shape === "array-of-objects") {
      return [Object.fromEntries(filled)];
    }
    // shape === "object" (documented), or unknown → preserve user intent as
    // a plain object. The previous default was `[Object.fromEntries(...)]`
    // which was wrong for any non-array-of-objects-shaped param.
    return Object.fromEntries(filled);
  }

  const computedJson = $derived.by(() => {
    const obj: Record<string, unknown> = {};
    for (const [rk, leaves] of Object.entries(value)) {
      const shaped = shapeLeaves(rk, leaves);
      if (shaped !== undefined) obj[rk] = shaped;
    }
    return JSON.stringify(obj, null, 2);
  });

  function parseRaw(text: string): Record<string, Record<string, string>> | null {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nextValue: Record<string, Record<string, string>> = {};
      for (const [rk, v] of Object.entries(parsed)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
          nextValue[rk] = Object.fromEntries(Object.entries(v[0] as Record<string, unknown>).map(([k, val]) => [k, String(val)]));
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          nextValue[rk] = { [rk]: String(v) };
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          // Scalar object shape (e.g. personFilter: { id: "abc" }): collapse
          // to {rk: {leaf: stringified}} so the form view can show it too.
          nextValue[rk] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, String(val)]));
        }
      }
      return nextValue;
    } catch {
      return null;
    }
  }

  // Commit raw-mode edits live so the URL preview + Send action see them
  // immediately. Parse failures (mid-keystroke) are silent — onChange just
  // doesn't fire until the JSON is valid again. The raw text becomes the
  // wire-canonical form for this param (rawOverride), so a Form→Raw round-
  // trip is lossless: the URL builder uses this verbatim instead of
  // reconstructing from chips.
  let rawInvalid = $state(false);
  function onRawInput(ev: Event) {
    rawText = (ev.target as HTMLTextAreaElement).value;
    if (!rawText.trim()) { onChange({}); onRawOverride(null); rawInvalid = false; return; }
    const parsed = parseRaw(rawText);
    if (parsed === null) { rawInvalid = true; return; }
    rawInvalid = false;
    onChange(parsed);
    onRawOverride(rawText);
  }

  function switchMode(next: "form" | "raw") {
    if (mode === "form" && next === "raw") {
      // Restore the user's last raw text if they typed one previously;
      // otherwise serialise chips through the documented shape.
      rawText = rawOverride ?? computedJson;
      rawInvalid = false;
    } else if (mode === "raw" && next === "form") {
      const parsed = parseRaw(rawText);
      if (parsed !== null) {
        onChange(parsed);
        onRawOverride(null); // chips are now the source of truth
      }
      // else: leave state as it was; user stays informed via the invalid flag
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
    <textarea class="cf-raw" class:invalid={rawInvalid} value={rawText} oninput={onRawInput} rows={6} placeholder={`{ "names": [{ "firstName": "James" }] }`}></textarea>
    {#if rawInvalid}
      <div class="cf-empty">JSON is invalid — last valid state is what will be sent.</div>
    {/if}
  {/if}
</div>

<style>
  .cf { display: flex; flex-direction: column; gap: var(--space-1-5); }
  .cf-head { display: flex; justify-content: space-between; align-items: center; }
  .cf-title { color: var(--fg); font-size: var(--fs-base); }
  .cf-dim { color: var(--fg-dim); }
  .cf-toggle { display: flex; gap: var(--space-0); }
  .cf-mode {
    background: transparent; color: var(--fg-dim);
    border: 1px solid var(--border); padding: 1px var(--space-1-5);
    font-family: inherit; cursor: pointer; font-size: var(--fs-sm);
  }
  .cf-mode.active { background: var(--bg-panel); color: var(--fg); border-color: var(--border-strong); }

  .cf-chips { display: flex; flex-direction: column; gap: var(--space-1); }
  .cf-chip { display: grid; grid-template-columns: minmax(110px, max-content) 1fr auto; gap: var(--space-1-5); align-items: center; }
  .cf-chip label { color: var(--fg-dim); font-size: var(--fs-base); }
  .cf-chip input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); padding: 3px var(--space-1-5);
    font-family: inherit; font-size: var(--fs-base);
  }
  .cf-chip.undoc label { color: var(--warn); }
  .cf-tag { font-size: var(--fs-xs); color: var(--warn-border); }
  .cf-x { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); cursor: pointer; padding: 0 var(--space-1-5); }

  .cf-picker { position: relative; }
  .cf-add {
    background: var(--bg-panel); color: var(--fg-dim);
    border: 1px dashed var(--border); padding: 3px var(--space-1-5);
    font-family: inherit; cursor: pointer; width: 100%; text-align: left;
  }
  .cf-add:hover { border-style: solid; color: var(--fg); }
  .cf-dropdown {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 5;
    background: var(--bg-panel); border: 1px solid var(--border-strong);
    padding: var(--space-1-5); max-height: 280px; overflow-y: auto;
  }
  .cf-search {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); padding: 3px var(--space-1-5);
    font-family: inherit; width: 100%; margin-bottom: var(--space-1-5);
  }
  .cf-group { color: var(--fg-dim); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.05em; margin-top: var(--space-1-5); }
  .cf-opt { padding: var(--space-0) var(--space-1-5); color: var(--fg); cursor: pointer; }
  .cf-opt:hover:not(.disabled) { background: var(--bg-panel); }
  .cf-opt.disabled { color: var(--fg-dim); opacity: 0.5; text-decoration: line-through; cursor: not-allowed; }

  .cf-raw {
    background: var(--bg); color: var(--fg-bright);
    border: 1px solid var(--border); padding: var(--space-1-5);
    font-family: inherit; font-size: var(--fs-sm); width: 100%; resize: vertical;
  }
  .cf-raw.invalid { border-color: var(--danger-border); }
  .cf-empty { color: var(--fg-dim); font-style: italic; font-size: var(--fs-sm); }
</style>
