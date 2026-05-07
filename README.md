# API Catalog Explorer

A local, clone-and-run Windows app for exploring the Ellucian API catalog — designed for PL/SQL veterans migrating from direct DB access to Ethos APIs, plus API-native developers who want fast exploration and testing.

## Running the app

**Prereqs**: Node.js 22.7+ (24 LTS recommended) on Windows. Get it from <https://nodejs.org/>. The server runs `.ts` files directly via Node's built-in TypeScript stripping, which lands on-by-default in 22.7.

There are two install paths depending on what your machine allows.

### Path A — run only (works on locked-down corporate Windows)

For end users who just want to run the app. No build tools, no native binaries, no `.exe` from npm — only the two pure-JS production deps and Node itself.

```
git clone https://github.com/cjsarab/unofficial-api-catalog.git
cd unofficial-api-catalog
npm ci --omit=dev
npm run start
```

`--omit=dev` skips Vite, Vitest, esbuild, tsx, Svelte, etc. — none of them are needed at runtime because the SPA is pre-built and committed under `dist/`. `npm run start` runs the server with plain `node server.ts` and serves the bundled SPA at <http://localhost:5757>.

This is the path to use if your org locks down `.exe` execution from user folders (AppLocker / WDAC / strict EDR). Symptoms of that on the standard install: `npm ci` fails with `errno -4094` or `code 'UNKNOWN'` during esbuild's postinstall.

### Path B — develop (full toolchain)

For working on the code itself.

```
git clone https://github.com/cjsarab/unofficial-api-catalog.git
cd unofficial-api-catalog
npm ci
npm run dev
```

`npm run dev` runs the API server (port 5757) and Vite (port 5173) side-by-side with HMR. Open <http://localhost:5173> for the dev experience.

`npm ci` is preferred over `npm install` for fresh clones — faster and deterministic, and dodges the partial-install state that trips up `npm install` on Windows.

### Common notes

To change the port (e.g. if 5757 clashes), set `PORT=5758` before invoking `npm run start` / `npm run dev`.

`dist/` is committed so Path A doesn't need a build step. Run `npm run build:web` and stage the result before pushing any UI changes.

If `npm ci` still fails with "failed to remove some directories" on Windows, something is holding files open in `node_modules/`. Close any editor/Explorer window on the project, run `taskkill /F /IM node.exe`, then retry.

## First-run setup

1. Launch via `npm run dev` (or `npm run start`). Browser opens to the first-run wizard. If your environment blocks `powershell.exe` from auto-opening it, the server prints `(could not auto-open browser: …)` — open <http://localhost:5757> manually.
2. Point the wizard at your local `APICatalog` folder. The app indexes the YAML specs into `./data/index.sqlite` (~2 minutes for the full ~4,400-spec catalog).
3. Open Settings → Environments and add an Ellucian environment profile with its API key. The key is stored plaintext in `./data/secrets.json` (gitignored).

You can also hand-edit `data/environments.json` and `data/secrets.json` directly if you prefer.

**Folder-picker note**: the "Browse" button in the first-run wizard shells out to `powershell.exe -ExecutionPolicy Bypass -File pick-folder.ps1`. Some corporate group policies override `-ExecutionPolicy Bypass` and reject the script. If "Browse" fails, type the catalog path into the wizard manually, or hand-edit `data/config.json` to set `catalogPath`.

## App data

Everything the app reads or writes lives under `./data/`:

```
data/
├─ config.json         # catalog path + region + recent paths
├─ index.sqlite        # the indexed catalog
├─ environments.json   # named env profiles (no secrets)
├─ secrets.json        # API keys IN PLAINTEXT — never commit
├─ layout.json         # UI panel sizes / collapse state
└─ theme.json          # selected theme + CRT effects
```

`data/` is gitignored; only `data/.gitkeep` is tracked. **Do not commit `data/secrets.json`** — it holds your Ellucian API keys in plaintext. The trust model is "single-user localhost desktop app", same as a `.env` file in any other Node project.

## Repository layout

```
api-catalog-explorer/
├─ server.ts            ← @hono/node-server entry: serves the SPA + proxies Ethos
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ vite.config.ts
├─ data/                ← runtime app data (gitignored)
├─ server/              ← server-side TypeScript
│  ├─ config.ts
│  ├─ indexer/          ← fs walker + YAML parser + node:sqlite + FTS5
│  ├─ validation/       ← catalog folder validator
│  ├─ auth/             ← Ethos JWT exchange + plaintext secret store
│  ├─ proxy/            ← forwards UI requests to Ethos with auth
│  ├─ environments/     ← env profile CRUD on environments.json
│  └─ routes/           ← per-route HTTP handlers
├─ web/                 ← Svelte SPA (compiled to `dist/` by Vite)
│  ├─ index.html
│  ├─ main.ts
│  ├─ App.svelte
│  ├─ shell/  sidebar/  docs/  settings/  styles/  lib/
├─ dist/                ← built static assets (committed; sourcemaps gitignored)
├─ fixtures/
│  └─ APICatalog/       ← small representative subset for tests
└─ tests/
```

## Scripts

```
npm run dev            # API + Vite HMR side-by-side (Ctrl+C stops both)
npm run dev:server     # API server only, watch mode
npm run dev:web        # Vite SPA only (proxies /api to :5757)
npm run build:web      # bundle SPA into dist/
npm run start          # production-style run (serves dist/)
npm test               # vitest run
npm run test:watch     # vitest watch mode
npm run typecheck      # tsc --noEmit
```

## Design principles (summary)

- **Clone-and-run** — `git clone && npm ci [--omit=dev] && npm run start|dev`. No native binaries on the runtime path.
- **Partial catalogs are first-class** — any subset of `*APIs/` families works.
- **Columns are the primary entity** for PL/SQL-veteran users; every column token is clickable.
- **Lineage has two layers** — API-to-API and field-to-DB-column; we surface both.
- **Windows-only** for launch. Ctrl-based shortcuts, plaintext secrets, PowerShell for native dialogs.
- **Never a silent error** — every failure has an actionable next step.
