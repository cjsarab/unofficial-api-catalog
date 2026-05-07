<script lang="ts">
  type Environment = {
    id: string;
    name: string;
    production: boolean;
  };
  type ThemeName = "phosphor" | "amber" | "dos" | "beige";

  type Props = {
    theme: ThemeName;
    onthemechange: (t: ThemeName) => void;
    envs: Environment[];
    activeEnvId: string | null;
    onactivate: (id: string) => void;
    onopensettings: () => void;
    openCommandPalette: () => void;
  };
  let { theme, onthemechange, envs, activeEnvId, onactivate, onopensettings, openCommandPalette }: Props = $props();

  const themes: ThemeName[] = ["phosphor", "amber", "dos", "beige"];

  const activeEnv = $derived(envs.find((e) => e.id === activeEnvId) ?? null);

  function onSelectChange(ev: Event) {
    const value = (ev.target as HTMLSelectElement).value;
    if (value && value !== activeEnvId) onactivate(value);
  }
</script>

<header class="top-bar">
  <button class="search-trigger" onclick={openCommandPalette} aria-label="Open search (Ctrl+K)">
    <span class="icon">⌕</span>
    <span class="placeholder">search APIs, columns, tables, domains…</span>
    <span class="hint">Ctrl+K</span>
  </button>

  <div class="right-controls">
    <div class="env-selector">
      <span class="dot" class:prod={activeEnv?.production === true}></span>
      <span class="label">env</span>
      <select value={activeEnvId ?? ""} onchange={onSelectChange} disabled={envs.length === 0}>
        <option value="" disabled>{envs.length === 0 ? "(none)" : "— select —"}</option>
        {#each envs as env (env.id)}
          <option value={env.id}>{env.name}{env.production ? " (PROD)" : ""}</option>
        {/each}
      </select>
    </div>

    <button class="gear" onclick={onopensettings} aria-label="Open settings" title="Settings">⚙</button>

    <div class="theme-selector" aria-label="theme">
      {#each themes as t (t)}
        <button
          class="swatch"
          data-theme={t}
          class:active={theme === t}
          onclick={() => onthemechange(t)}
          aria-label={`Switch to ${t} theme`}
          title={t}
        ></button>
      {/each}
    </div>
  </div>
</header>

<style>
  .top-bar { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-2) var(--space-4); background: var(--bg-panel); border-bottom: 1px solid var(--border); }
  .search-trigger { flex: 1; display: flex; align-items: center; gap: var(--space-3); background: var(--bg); color: var(--fg-dim); border: 1px solid var(--border); padding: var(--space-2) var(--space-3); font-family: var(--font-mono); cursor: pointer; text-align: left; }
  .search-trigger:hover { color: var(--fg); }
  .search-trigger .placeholder { flex: 1; }
  .search-trigger .hint { color: var(--fg-dim); font-size: 0.8rem; }

  .right-controls { display: flex; align-items: center; gap: var(--space-3); }

  .env-selector { display: flex; align-items: center; gap: var(--space-2); color: var(--fg-dim); font-family: var(--font-mono); font-size: 0.9rem; }
  .env-selector .dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--fg-dim); background: transparent; display: inline-block; }
  .env-selector .dot.prod { background: var(--danger); border-color: var(--danger); }
  .env-selector select { background: var(--bg); color: var(--fg); border: 1px solid var(--border); padding: var(--space-1) var(--space-2); font-family: var(--font-mono); }
  .env-selector select:disabled { opacity: 0.5; }

  .gear { background: transparent; color: var(--fg-dim); border: 1px solid var(--border); padding: var(--space-1) var(--space-3); font-family: var(--font-mono); font-size: 1rem; cursor: pointer; }
  .gear:hover { color: var(--fg-bright); background: var(--bg-raised); }

  .theme-selector { display: flex; gap: 3px; }
  .theme-selector .swatch {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border);
    cursor: pointer;
  }
  /* Half-and-half diagonal split of each theme's bg + fg. DOS has the
     most striking split because its palette has the highest bg/fg contrast. */
  .theme-selector .swatch[data-theme="phosphor"] { background: linear-gradient(45deg, #0d120d 50%, #a9ff68 50%); }
  .theme-selector .swatch[data-theme="amber"]    { background: linear-gradient(45deg, #150f05 50%, #ffb95c 50%); }
  .theme-selector .swatch[data-theme="dos"]      { background: linear-gradient(45deg, #00007a 50%, #e6e6e6 50%); }
  .theme-selector .swatch[data-theme="beige"]    { background: linear-gradient(45deg, #efe8d4 50%, #23201a 50%); }
  .theme-selector .swatch.active {
    outline: 2px solid var(--fg-bright);
    outline-offset: 1px;
  }
</style>
