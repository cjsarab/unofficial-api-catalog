import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";

type StringDirent = Dirent<string>;

async function readdirWithTypes(path: string): Promise<StringDirent[]> {
  return (await readdir(path, { withFileTypes: true })) as StringDirent[];
}

/** The 20 known Ellucian product families, from the catalog exploration. */
export const EXPECTED_FAMILIES = [
  "ApplyAPIs",
  "ApplyEedmAPIs",
  "BannerBusAPIs",
  "BannerEedmAPIs",
  "BannerErpAPIs",
  "BannerSpecAPIs",
  "CRMAdvanceEedmAPIs",
  "CRMRecruitEedmAPIs",
  "ColleagueBusAPIs",
  "ColleagueEedmAPIs",
  "ColleagueSpecAPIs",
  "ColleagueWebEthosAPIs",
  "ColleagueWebNonEthosAPIs",
  "DegreeWorksAPIs",
  "EllDocumentMgmtAPIs",
  "ExperienceAPIs",
  "MaestroAPIs",
  "PersonManagerAPIs",
  "PowerCampusAPIs",
  "PowerCampusEedmAPIs",
] as const;

const FAMILY_PATTERN = /APIs$/;

export interface FamilyStat {
  name: string;
  resourceCount: number;
  yamlCount: number;
}

export interface CatalogValidation {
  path: string;
  valid: boolean;
  exists: boolean;
  readable: boolean;
  isDirectory: boolean;
  /** Families actually found (sorted). */
  familiesFound: FamilyStat[];
  /** Names of expected families missing from this path. */
  familiesMissing: string[];
  /** Total YAMLs found across all family folders. */
  yamlCount: number;
  /** Total size on disk (bytes) across the catalog tree. */
  totalSizeBytes: number;
  /** Set if the user pointed at a subfolder that looks like a family — suggest the parent. */
  suggestedParent?: string;
  /** Set if the user pointed at a zip file. */
  isZip?: boolean;
  /** Non-fatal warnings. */
  warnings: string[];
  /** Fatal errors — `valid` is always false if any present. */
  errors: string[];
}

export async function validateCatalogPath(rawPath: string): Promise<CatalogValidation> {
  const path = (rawPath ?? "").trim();
  const result: CatalogValidation = {
    path,
    valid: false,
    exists: false,
    readable: false,
    isDirectory: false,
    familiesFound: [],
    familiesMissing: [],
    yamlCount: 0,
    totalSizeBytes: 0,
    warnings: [],
    errors: [],
  };

  if (!path) {
    result.errors.push("Path is empty.");
    return result;
  }

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(path);
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "Path does not exist."
      : `Cannot access path: ${(err as Error).message}`;
    result.errors.push(message);
    return result;
  }
  result.exists = true;

  if (!st.isDirectory()) {
    if (/\.zip$/i.test(path)) {
      result.isZip = true;
      result.errors.push("This is a zip file. Unzip it first, then point at the resulting folder.");
    } else {
      result.errors.push("Path is not a directory.");
    }
    return result;
  }
  result.isDirectory = true;

  let entries: StringDirent[];
  try {
    entries = await readdirWithTypes(path);
  } catch (err) {
    result.errors.push(`Cannot read directory: ${(err as Error).message}`);
    return result;
  }
  result.readable = true;

  const familyDirs = entries
    .filter((e) => e.isDirectory() && FAMILY_PATTERN.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Did they point at a single family folder by mistake?
  if (familyDirs.length === 0 && FAMILY_PATTERN.test(basename(path))) {
    const parent = dirname(path);
    try {
      const parentEntries = await readdirWithTypes(parent);
      const siblingFamilies = parentEntries.filter(
        (e) => e.isDirectory() && FAMILY_PATTERN.test(e.name),
      );
      if (siblingFamilies.length > 0) {
        result.suggestedParent = parent;
        result.warnings.push(
          `This looks like a single family folder. The parent "${parent}" contains ${siblingFamilies.length} "*APIs" folders — you probably meant that.`,
        );
      }
    } catch {
      // parent unreadable → leave suggestion blank
    }
  }

  if (familyDirs.length === 0) {
    result.errors.push(
      'No "*APIs/" subdirectories found. Expected layout: APICatalog/<Family>APIs/<resource-version>/<resource>.yaml',
    );
    return result;
  }

  // Tally YAMLs and size per family.
  let totalYamls = 0;
  let totalBytes = 0;
  const stats: FamilyStat[] = [];

  for (const fam of familyDirs) {
    const famPath = join(path, fam.name);
    let resources: StringDirent[] = [];
    try {
      resources = await readdirWithTypes(famPath);
    } catch {
      continue;
    }

    let yamlCount = 0;
    let resourceCount = 0;
    for (const r of resources) {
      if (!r.isDirectory()) continue;
      resourceCount += 1;
      const resourcePath = join(famPath, r.name);
      try {
        const files = await readdirWithTypes(resourcePath);
        for (const f of files) {
          if (!f.isFile() || !/\.ya?ml$/i.test(f.name)) continue;
          yamlCount += 1;
          try {
            const fs = await stat(join(resourcePath, f.name));
            totalBytes += fs.size;
          } catch {
            // ignore individual stat failure
          }
        }
      } catch {
        // unreadable resource folder — skip
      }
    }

    stats.push({ name: fam.name, resourceCount, yamlCount });
    totalYamls += yamlCount;
  }

  result.familiesFound = stats;
  result.yamlCount = totalYamls;
  result.totalSizeBytes = totalBytes;

  const foundNames = new Set(stats.map((s) => s.name));
  result.familiesMissing = EXPECTED_FAMILIES.filter((n) => !foundNames.has(n));

  if (totalYamls === 0) {
    result.errors.push(
      `Found ${familyDirs.length} family folders but no YAML files inside. The catalog looks empty or uses a different layout.`,
    );
    return result;
  }

  // Warnings about unknown families (vendor added new ones we haven't seen).
  const unknownFamilies = stats.filter((s) => !EXPECTED_FAMILIES.includes(s.name as (typeof EXPECTED_FAMILIES)[number]));
  if (unknownFamilies.length > 0) {
    result.warnings.push(
      `${unknownFamilies.length} family folder(s) beyond the 20 we know about: ${unknownFamilies.map((u) => u.name).join(", ")}. Indexing them anyway.`,
    );
  }

  result.valid = true;
  return result;
}

/**
 * Probe likely catalog locations based on a few heuristics:
 *   - siblings of a previously-used path (if supplied)
 *   - subfolders of the user's Documents / Downloads / Desktop
 *   - any folder named APICatalog (case-insensitive) or matching *APIs
 */
export async function probeLikelyPaths(options: {
  lastKnownPath?: string;
  recent?: string[];
  limit?: number;
} = {}): Promise<string[]> {
  const { lastKnownPath, recent = [], limit = 8 } = options;

  const candidates = new Set<string>();

  const addIfFolder = async (p: string) => {
    try {
      const s = await stat(p);
      if (s.isDirectory()) candidates.add(resolve(p));
    } catch {
      // ignore
    }
  };

  for (const r of recent) await addIfFolder(r);

  if (lastKnownPath) {
    const parent = dirname(lastKnownPath);
    try {
      const parentEntries = await readdirWithTypes(parent);
      for (const e of parentEntries) {
        if (e.isDirectory() && /api.?catalog/i.test(e.name)) {
          await addIfFolder(join(parent, e.name));
        }
      }
    } catch {
      // parent inaccessible
    }
  }

  const home = process.env.USERPROFILE ?? ".";
  for (const commonDir of ["Documents", "Downloads", "Desktop"]) {
    const base = join(home, commonDir);
    try {
      const entries = await readdirWithTypes(base);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (/api.?catalog/i.test(e.name)) {
          await addIfFolder(join(base, e.name));
        }
      }
    } catch {
      // directory missing — fine
    }
  }

  return [...candidates].slice(0, limit);
}
