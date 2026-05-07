import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Run from the repo root so both server (tests/) and web (web/**) tests are
  // discovered. Vite's own config (vite.config.ts) roots at web/ for the SPA
  // dev server — that root is intentionally narrower and not what we want for
  // tests.
  root: projectRoot,
  // node:sqlite is a Node 22.7+ experimental builtin that Vite/Vitest's
  // builtinModules check doesn't recognise (it's "only-prefixed" — never
  // appears in module.builtinModules without the `node:` prefix). Mark it
  // external in every place Vite/Vitest looks so neither the dep optimiser
  // nor the SSR transformer tries to load it as a regular package.
  optimizeDeps: { exclude: ["node:sqlite"] },
  ssr: { external: ["node:sqlite"] },
  test: {
    include: ["tests/**/*.test.ts", "web/**/*.test.ts"],
    pool: "forks",
    server: {
      deps: {
        external: ["node:sqlite", /^node:sqlite$/],
      },
    },
  },
  resolve: {
    alias: [
      { find: "@server", replacement: resolve(projectRoot, "server") },
      { find: "@web", replacement: resolve(projectRoot, "web") },
    ],
  },
});
