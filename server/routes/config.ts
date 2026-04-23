import type { RouteHandler } from "./types.ts";
import {
  clearCatalogPath,
  pruneRecentPaths,
  setCatalogPath,
  setRegion,
} from "../config-store.ts";
import { isValidRegion } from "../environments/region.ts";
import { validateCatalogPath } from "../validation/catalog.ts";

export const handleConfig: RouteHandler = async (req, url) => {
  if (url.pathname === "/api/config" && req.method === "GET") {
    // Drop any recent paths that no longer point at a readable folder before
    // reporting to the UI — otherwise stale entries linger in the Recent list.
    const config = await pruneRecentPaths();
    // Also report whether the saved catalogPath is currently reachable so the UI
    // can surface "your catalog folder is gone" instead of silently showing a
    // stale dashboard.
    let catalogPathStatus: "ok" | "missing" | "invalid" | "none" = "none";
    let catalogPathError: string | undefined;
    if (config.catalogPath) {
      const v = await validateCatalogPath(config.catalogPath);
      if (!v.exists) catalogPathStatus = "missing";
      else if (!v.valid) catalogPathStatus = "invalid";
      else catalogPathStatus = "ok";
      if (!v.valid) catalogPathError = v.errors[0];
    }
    return Response.json({ ...config, catalogPathStatus, catalogPathError });
  }

  if (url.pathname === "/api/config/catalog-path" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { path?: string };
    const path = body.path?.trim();
    if (!path) return Response.json({ error: "path required" }, { status: 400 });
    const validation = await validateCatalogPath(path);
    if (!validation.valid) {
      return Response.json({ error: "invalid catalog path", validation }, { status: 400 });
    }
    const updated = await setCatalogPath(path);
    return Response.json({ config: updated, validation });
  }

  if (url.pathname === "/api/config/catalog-path" && req.method === "DELETE") {
    const updated = await clearCatalogPath();
    return Response.json({ config: updated });
  }

  if (url.pathname === "/api/config/region" && req.method === "PUT") {
    const body = (await req.json().catch(() => ({}))) as { region?: string };
    if (!isValidRegion(body.region)) {
      return Response.json({ error: "region must be one of: us, ca, eu, ap" }, { status: 400 });
    }
    const updated = await setRegion(body.region);
    return Response.json({ config: updated });
  }
};
