# API Catalog Explorer

A local, clone-and-run Windows app for exploring the Ellucian API catalog — designed for PL/SQL veterans migrating from direct DB access to Ethos APIs, plus API-native developers who want fast exploration and testing.

See `PLAN.md` for the full design plan.

## Running the app

**Prereqs**: Node.js 22.5+ (24 LTS recommended) on Windows. Get it from <https://nodejs.org/>.

```
git clone <repo>
cd api-catalog-explorer
npm install
npm run dev
```

`npm run dev` runs the API server (port 5757) and Vite (port 5173) side-by-side with HMR. Open <http://localhost:5173> for the dev experience, or <http://localhost:5757> for the production-style preview after a `npm run build:web`.

For a production-style run (serves the built SPA at <http://localhost:5757>):

```
npm run build:web
npm run start
```

To change the port (e.g. if 5757 clashes), set `PORT=5758` before invoking `npm run start` / `npm run dev`.

Double-click `launch.bat` for a one-step `npm install` + `npm run start`. `dev.bat` does the same for `npm run dev`.

## First-run setup

1. Launch via `npm run dev` (or `launch.bat`). Browser opens to the first-run wizard.
2. Point the wizard at your local `APICatalog` folder. The app indexes the YAML specs into `./data/index.sqlite` (~2 minutes for the full ~4,400-spec catalog).
3. Open Settings → Environments and add an Ellucian environment profile with its API key. The key is stored plaintext in `./data/secrets.json` (gitignored).

You can also hand-edit `data/environments.json` and `data/secrets.json` directly if you prefer.

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
├─ launch.bat           ← npm install + npm run start (double-click)
├─ dev.bat              ← npm run dev
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
├─ dist/                ← built static assets (gitignored)
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

- **Clone-and-run** — `git clone && npm install && npm run dev`.
- **Partial catalogs are first-class** — any subset of `*APIs/` families works.
- **Columns are the primary entity** for PL/SQL-veteran users; every column token is clickable.
- **Lineage has two layers** — API-to-API and field-to-DB-column; we surface both.
- **Windows-only** for launch. Ctrl-based shortcuts, plaintext secrets, PowerShell for native dialogs.
- **Never a silent error** — every failure has an actionable next step.
