// Repo-local app data: every runtime file the server reads/writes lives under
// ./data/. The ./data/ directory is gitignored. NOTE: data/secrets.json holds
// API keys in plaintext — never commit it. The .gitignore has explicit guards
// (`/data/*` + `secrets.json` patterns) but treat this file as a second line
// of defense against accidental commits.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_VERSION = "0.1.0";

// Project root: this file lives at <root>/server/config.ts, so one level up.
// Used by the static asset server to locate dist/ regardless of cwd.
export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST_DIR = join(APP_ROOT, "dist");

// Whether the SPA bundle exists. Computed once at module load — the answer
// can't change during a single server run.
export const HAS_DIST = existsSync(join(DIST_DIR, "index.html"));

// Fixed default port so the URL in the user's browser remains stable across
// launches (refresh works). Override with PORT=1234 when needed.
export const PORT = Number(process.env.PORT) || 5757;

export const APP_DATA_DIR = join(APP_ROOT, "data");
export const CONFIG_PATH = join(APP_DATA_DIR, "config.json");
export const INDEX_PATH = join(APP_DATA_DIR, "index.sqlite");
export const LAYOUT_PATH = join(APP_DATA_DIR, "layout.json");
export const THEME_PATH = join(APP_DATA_DIR, "theme.json");
export const ENVIRONMENTS_PATH = join(APP_DATA_DIR, "environments.json");
export const SECRETS_PATH = join(APP_DATA_DIR, "secrets.json");
export const BASKETS_DIR = join(APP_DATA_DIR, "baskets");
export const THEMES_DIR = join(APP_DATA_DIR, "themes");
