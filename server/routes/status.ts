import type { RouteHandler } from "./types.ts";
import { APP_VERSION, HAS_DIST } from "../config.ts";

export const handleStatus: RouteHandler = (_req, url) => {
  if (url.pathname === "/api/status") {
    return Response.json({
      status: "ok",
      version: APP_VERSION,
      bun: Bun.version,
      platform: process.platform,
      dist: HAS_DIST ? "served" : "scaffolding-placeholder",
    });
  }
};
