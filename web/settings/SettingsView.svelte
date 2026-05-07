<script lang="ts">
  import EnvironmentsPanel from "./EnvironmentsPanel.svelte";
  import AppearancePanel from "./AppearancePanel.svelte";
  import CatalogPanel from "./CatalogPanel.svelte";

  type Environment = {
    id: string;
    name: string;
    production: boolean;
    hasApiKey: boolean;
  };
  type ThemeName = "phosphor" | "amber" | "dos" | "beige";
  type Section = "environments" | "appearance" | "catalog";
  type Region = "us" | "ca" | "eu" | "ap";

  type Props = {
    section: Section;
    envs: Environment[];
    activeEnvId: string | null;
    onChange: (envs: Environment[], activeEnvId: string | null) => void;
    onClose: () => void;
    theme: ThemeName;
    onthemechange: (t: ThemeName) => void;
    catalogPath?: string;
    onsectionchange: (s: Section) => void;
    region: Region;
    onregionchange: (r: Region) => void;
  };
  let {
    section,
    envs,
    activeEnvId,
    onChange,
    onClose,
    theme,
    onthemechange,
    catalogPath,
    onsectionchange,
    region,
    onregionchange,
  }: Props = $props();

  const sections: Array<{ id: Section; label: string }> = [
    { id: "environments", label: "Environments" },
    { id: "appearance", label: "Appearance" },
    { id: "catalog", label: "Catalog" },
  ];
</script>

<div class="settings-view">
  <header class="settings-header">
    <h1 class="settings-title">Settings</h1>
    <button class="close-btn" onclick={onClose} aria-label="Close settings" title="Close">×</button>
  </header>

  <div class="settings-body">
    <nav class="section-nav" role="tablist" aria-label="Settings sections">
      {#each sections as s (s.id)}
        <button
          role="tab"
          aria-selected={section === s.id}
          class="nav-item"
          class:active={section === s.id}
          onclick={() => onsectionchange(s.id)}
        >{s.label}</button>
      {/each}
    </nav>

    <section class="section-content">
      {#if section === "environments"}
        <EnvironmentsPanel {envs} {activeEnvId} {onChange} {region} {onregionchange} />
      {:else if section === "appearance"}
        <AppearancePanel {theme} {onthemechange} />
      {:else if section === "catalog"}
        <CatalogPanel {catalogPath} />
      {/if}
    </section>
  </div>
</div>

<style>
  .settings-view {
    padding: var(--space-5) var(--space-6);
    max-width: 900px;
    margin: 0 auto;
    color: var(--fg);
    font-family: var(--font-mono);
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin: 0 0 var(--space-5) 0;
  }
  .settings-title {
    font-size: 1.5rem;
    color: var(--fg-bright);
    margin: 0;
    font-weight: 600;
  }
  .close-btn {
    font: inherit;
    background: var(--bg-raised);
    color: var(--fg-dim);
    border: 1px solid var(--border-strong);
    padding: 3px 7px;
    cursor: pointer;
    line-height: 1;
  }
  .close-btn:hover { color: var(--accent); border-color: var(--accent); }

  .settings-body {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: var(--space-6);
    align-items: start;
  }
  .section-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .nav-item {
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid transparent;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
  }
  .nav-item:hover { color: var(--fg); background: var(--bg-raised); }
  .nav-item.active {
    color: var(--fg-bright);
    background: var(--bg-panel);
    border-color: var(--border-strong);
  }
  .section-content { min-width: 0; }
</style>
