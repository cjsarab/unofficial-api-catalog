import type { RouteHandler } from "./types.ts";
import { db } from "../db.ts";

// Families tree: one-shot response with every resource and its versions,
// grouped by family. Used by the left-sidebar FamilyTree section. ~4377
// rows grouped into ~20 families → a few hundred KB of JSON.
export const handleFamilies: RouteHandler = (_req, url) => {
  if (url.pathname !== "/api/families/tree") return;

  type ApiRow = {
    id: number;
    family: string;
    resource: string;
    version: string;
    title: string | null;
    source_domain: string | null;
    release_status: string | null;
  };
  const rows = db()
    .query<ApiRow, []>(
      `
      SELECT id, family, resource, version, title, source_domain, release_status
      FROM apis
      ORDER BY family, resource, version
      `,
    )
    .all();

  // Group: family → resource → versions
  const byFamily = new Map<
    string,
    Map<
      string,
      { version: string; id: number; title: string | null; sourceDomain: string | null; releaseStatus: string | null }[]
    >
  >();

  for (const r of rows) {
    let byResource = byFamily.get(r.family);
    if (!byResource) {
      byResource = new Map();
      byFamily.set(r.family, byResource);
    }
    let versions = byResource.get(r.resource);
    if (!versions) {
      versions = [];
      byResource.set(r.resource, versions);
    }
    versions.push({
      version: r.version,
      id: r.id,
      title: r.title,
      sourceDomain: r.source_domain,
      releaseStatus: r.release_status,
    });
  }

  const families = [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, byResource]) => ({
      family,
      resourceCount: byResource.size,
      resources: [...byResource.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([resource, versions]) => ({ resource, versions })),
    }));

  return Response.json({ families, totalApis: rows.length });
};
