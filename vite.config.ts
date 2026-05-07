import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname);

export default defineConfig({
  root: resolve(projectRoot, "web"),
  // plugin-svelte 6+ resolves configFile relative to vite's root (web/), so
  // hand it the absolute path to the project-root svelte.config.js to avoid
  // the "no Svelte config found" warning + silent fallback to defaults.
  plugins: [svelte({ configFile: resolve(projectRoot, "svelte.config.js") })],
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    target: "esnext",
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.API_SERVER ?? "http://localhost:5757",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@web": resolve(projectRoot, "web"),
      "@server": resolve(projectRoot, "server"),
    },
  },
});
