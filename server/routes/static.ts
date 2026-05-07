import { join, normalize, resolve } from "node:path";
import type { RouteHandler } from "./types.ts";
import { DIST_DIR, HAS_DIST, PORT } from "../config.ts";

const placeholderHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>API Catalog Explorer — scaffolding</title>
  <style>
    :root {
      --bg: #0d120d;
      --fg: #a9ff68;
      --dim: #6ba544;
      --accent: #c9ff9a;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      color-scheme: dark;
    }
    body { margin: 0; background: var(--bg); color: var(--fg); display: grid; place-items: center; min-height: 100vh; }
    main { max-width: 680px; padding: 32px 36px; border: 1px solid #1e2a1e; }
    h1 { color: var(--accent); margin: 0 0 4px; font-size: 22px; letter-spacing: 0.02em; }
    .tag { color: var(--dim); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
    p { line-height: 1.55; margin: 12px 0; }
    code { background: #111a11; padding: 1px 6px; border: 1px solid #1e2a1e; }
    ul { padding-left: 20px; }
    li { margin: 4px 0; }
  </style>
</head>
<body>
  <main>
    <div class="tag">API Catalog Explorer · scaffolding</div>
    <h1>The server is running.</h1>
    <p>The SPA hasn't been built yet. This is the bare Bun server confirming the runtime works and the launch flow is correct.</p>
    <p>Next steps in the build sequence:</p>
    <ul>
      <li>Build the Svelte SPA: <code>bun run build:web</code></li>
      <li>Re-run the launcher — the server will serve <code>dist/index.html</code> from here.</li>
      <li>Iterate on the indexer, catalog drop-in, column profile, and so on.</li>
    </ul>
    <p class="tag">listening on <code>http://localhost:${PORT || "(assigned)"}</code></p>
  </main>
</body>
</html>`;

// Final fallback in the dispatch chain. Either serves a file from the built
// SPA bundle (with SPA-style 404→index.html for client-side routing), or shows
// the dev-mode placeholder when no bundle is present.
export const handleStatic: RouteHandler = async (_req, url) => {
  if (HAS_DIST) {
    const resolved = resolve(DIST_DIR, "." + normalize(url.pathname));
    if (!resolved.startsWith(DIST_DIR)) {
      return new Response("forbidden", { status: 403 });
    }
    const requested = url.pathname === "/" ? join(DIST_DIR, "index.html") : resolved;
    const file = Bun.file(requested);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(DIST_DIR, "index.html")));
  }

  return new Response(placeholderHtml, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};
