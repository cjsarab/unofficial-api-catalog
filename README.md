# API Catalog Explorer

A zero-install, local Windows app for exploring the Ellucian API catalog — designed for PL/SQL veterans migrating from direct DB access to Ethos APIs, plus API-native developers who want fast exploration and testing.

See `C:\Users\cjsar\.claude\plans\memoized-knitting-bengio.md` for the full design plan.

## Running the app

Double-click `launch.bat`. On first run it will download the portable Bun runtime to `bun.exe` alongside the script (one-time, ~30 MB). Subsequent launches reuse that copy.

The app opens in your default Windows browser at **http://localhost:5757**. The port is fixed so refresh and bookmark work. Close the console window to stop the server. To change the port (e.g. if 5757 clashes with something else on your machine), set `PORT=5758` before invoking `launch.bat`.

## Repository layout

```
api-catalog-explorer/
├─ launch.bat           ← entrypoint (double-click this)
├─ setup.bat            ← downloads the Bun runtime on first run
├─ server.ts            ← Bun HTTP server: serves the SPA + proxies Ethos calls
├─ package.json         ← single manifest, Bun workspace
├─ tsconfig.json
├─ server/              ← server-side TypeScript
│  ├─ config.ts
│  ├─ indexer/          ← fs walker + YAML parser + SQLite + FTS5
│  ├─ validation/       ← catalog folder validator
│  ├─ auth/             ← OAuth2 (Ethos) + DPAPI (Windows Credential Manager)
│  ├─ proxy/            ← forwards UI requests to Ethos with auth
│  └─ migration/        ← set-cover matcher + SQL column extraction
├─ web/                 ← Svelte SPA (compiled to `dist/` by Vite)
│  ├─ index.html
│  ├─ main.ts
│  ├─ App.svelte
│  ├─ routes/
│  ├─ lib/
│  └─ styles/
├─ dist/                ← built static assets (gitignored; created by `bun run build:web`)
├─ fixtures/
│  └─ APICatalog/       ← small representative subset for tests
└─ tests/
```

## Development

Bun is portable (lives at `./bun.exe` in the project folder). From bash use `./bun.exe`; from cmd/PowerShell just `bun.exe`. Convenience wrappers:

```
launch.bat       # production-style run (serves dist/); double-click this
dev.bat          # Vite HMR dev loop (UI @ :5173, API @ :8080)
```

Raw scripts (prepend `./bun.exe` or run from a cmd window inside the repo):

```
bun.exe install          # install dependencies
bun.exe run dev:web      # Vite dev server for the SPA (http://localhost:5173)
bun.exe run dev          # Bun server with watch mode
bun.exe test             # unit tests
bun.exe run typecheck    # TypeScript check
bun.exe run build:web    # bundle SPA into dist/
bun.exe run launch       # production-style run (serves dist/)
```

## Design principles (summary)

- **Zero install for end users** — the release zip includes everything.
- **Partial catalogs are first-class** — any subset of `*APIs/` families works.
- **Columns are the primary entity** for PL/SQL-veteran users; every column token is clickable.
- **Lineage has two layers** — API-to-API and field-to-DB-column; we surface both.
- **Windows-only** for launch. Ctrl-based shortcuts, DPAPI for secrets, PowerShell for native dialogs.
- **Never a silent error** — every failure has an actionable next step.
