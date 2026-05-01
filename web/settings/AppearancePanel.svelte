<script lang="ts">
  type ThemeName = "phosphor" | "amber" | "dos" | "beige";

  type Props = {
    theme: ThemeName;
    onthemechange: (t: ThemeName) => void;
  };
  let { theme, onthemechange }: Props = $props();

  const themes: ThemeName[] = ["phosphor", "amber", "dos", "beige"];
</script>

<section class="appearance-panel">
  <header>
    <h2>Appearance</h2>
  </header>

  <div class="subsection">
    <h3>Theme</h3>
    <div class="theme-row">
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
      <span class="theme-name">{theme}</span>
    </div>
  </div>

  <div class="subsection placeholder">
    <h3>CRT effects</h3>
    <p>Scanlines, glow, curvature, chromatic aberration, flicker, background noise — configurable in a later release (Phase 3).</p>
  </div>
</section>

<style>
  .appearance-panel { display: flex; flex-direction: column; gap: var(--space-5); }
  .appearance-panel h2 { font-size: 1.1rem; margin: 0; color: var(--fg); }
  .subsection { display: flex; flex-direction: column; gap: var(--space-3); }
  .subsection h3 { font-size: 0.95rem; margin: 0; color: var(--fg-dim); font-weight: 600; }
  .subsection.placeholder { opacity: 0.7; }
  .subsection.placeholder p { color: var(--fg-dim); font-size: 0.9rem; margin: 0; }

  .theme-row { display: flex; align-items: center; gap: var(--space-3); }
  .swatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    cursor: pointer;
  }
  /* swatch backgrounds defined in web/styles/theme-swatches.css */
  .swatch.active {
    outline: 2px solid var(--fg-bright);
    outline-offset: 1px;
  }
  .theme-name { color: var(--fg-dim); font-size: 0.9rem; }
</style>
