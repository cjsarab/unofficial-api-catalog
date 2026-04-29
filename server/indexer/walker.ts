import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface WalkedFile {
  path: string;
  family: string;
  resourceFolder: string;
  filename: string;
  size: number;
  mtimeMs: number;
}

const FAMILY_PATTERN = /APIs$/;
const YAML_PATTERN = /\.ya?ml$/i;

export async function* walkCatalog(
  rootDir: string,
  signal?: AbortSignal,
): AsyncGenerator<WalkedFile> {
  let rootEntries;
  try {
    rootEntries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  signal?.throwIfAborted();

  const familyDirs = rootEntries
    .filter((e) => e.isDirectory() && FAMILY_PATTERN.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const familyDir of familyDirs) {
    signal?.throwIfAborted();
    const familyPath = join(rootDir, familyDir.name);
    let resourceEntries;
    try {
      resourceEntries = await readdir(familyPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const resourceEntry of resourceEntries) {
      if (!resourceEntry.isDirectory()) continue;
      signal?.throwIfAborted();
      const resourceFolderPath = join(familyPath, resourceEntry.name);
      let files;
      try {
        files = await readdir(resourceFolderPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.isFile() || !YAML_PATTERN.test(file.name)) continue;
        const filePath = join(resourceFolderPath, file.name);
        let st;
        try {
          st = await stat(filePath);
        } catch {
          continue;
        }
        yield {
          path: filePath,
          family: familyDir.name,
          resourceFolder: resourceEntry.name,
          filename: file.name,
          size: st.size,
          mtimeMs: Math.floor(st.mtimeMs),
        };
      }
    }
  }
}

/**
 * Parse an Ellucian-style resource folder name into `{resource, version}`.
 *   `fraud-checks-1.0.0`                 → {resource: "fraud-checks",                 version: "1.0.0"}
 *   `academic-catalogs-6.1.0`            → {resource: "academic-catalogs",            version: "6.1.0"}
 *   `account-detail-charges-payments-0.1.0` → {resource: "account-detail-charges-payments", version: "0.1.0"}
 *   `x-da-student-course-registration-1.0.0` → {resource: "x-da-student-course-registration", version: "1.0.0"}
 */
export function parseResourceFolderName(folderName: string): { resource: string; version: string } {
  // Version is the trailing numeric-and-dots suffix.
  const match = folderName.match(/^(.+?)-(\d+(?:\.\d+)*)$/);
  if (match) {
    return { resource: match[1]!, version: match[2]! };
  }
  return { resource: folderName, version: "unknown" };
}
