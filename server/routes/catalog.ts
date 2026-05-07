import type { RouteHandler } from "./types.ts";
import { loadConfig } from "../config-store.ts";
import { probeLikelyPaths, validateCatalogPath } from "../validation/catalog.ts";
import { showWindowsFolderPicker } from "../validation/picker.ts";

export const handleCatalog: RouteHandler = async (req, url) => {
  if (url.pathname === "/api/catalog/validate" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { path?: string };
    const path = body.path ?? "";
    const validation = await validateCatalogPath(path);
    return Response.json(validation);
  }

  if (url.pathname === "/api/catalog/browse" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as {
      description?: string;
      initialPath?: string;
    };
    const result = await showWindowsFolderPicker({
      description: body.description,
      initialPath: body.initialPath,
    });
    return Response.json(result);
  }

  if (url.pathname === "/api/catalog/probes") {
    const config = await loadConfig();
    const paths = await probeLikelyPaths({
      lastKnownPath: config.catalogPath,
      recent: config.recentPaths,
    });
    // Validate each candidate briefly so the UI can badge good ones.
    const validated = await Promise.all(
      paths.map(async (p) => {
        const v = await validateCatalogPath(p);
        return {
          path: p,
          valid: v.valid,
          familiesFound: v.familiesFound.length,
          yamlCount: v.yamlCount,
        };
      }),
    );
    return Response.json({ probes: validated });
  }
};
