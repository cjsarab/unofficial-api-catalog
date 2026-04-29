import type { EndpointSchema, OpenAPIParameter } from "../../lib/openapi.ts";
import { scrapeCriteriaFilters } from "../../lib/criteria-scraper.ts";

/** Shared selector for ParamsTab + the URL builder + version migration: any
 *  object-type query param is rendered through CriteriaFilter, which has a
 *  Form mode (when its description scrapes into ExtractedFilters — `criteria`
 *  on persons / `personFilter` etc.) and a Raw JSON fallback (when the
 *  description is empty or unscrapable — `criteria` / `sort` on
 *  academic-catalogs). SchemaInput's `type:object` branch only handles
 *  schemas with explicit `properties`; bare-object query params have none
 *  and would render an empty container. */
export function isCriteriaParam(p: OpenAPIParameter): boolean {
  return p.in === "query" && p.schema?.type === "object";
}

export interface FormState {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  /** Per-param criteria values: paramName → rootKey → leafName → value.
   *  Multiple object-type query params (e.g. `criteria` + `personFilter` on
   *  the persons endpoint, or `criteria` + `sort` on academic-catalogs) each
   *  get their own entry. */
  criteria: Record<string, Record<string, Record<string, string>>>;
  headers: Array<{ name: string; value: string }>;
  body: { mode: "form" | "raw"; text: string };
  /** Names the user explicitly overrode (don't auto-recompute on version change). */
  headersOverridden: Record<string, boolean>;
  /** Fields that used to exist but don't in the current version — preserved verbatim. */
  orphans?: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    criteria?: Record<string, Record<string, Record<string, string>>>;
  };
}

export type MigrationWarning =
  | { kind: "orphan-path-param"; names: string[] }
  | { kind: "orphan-query-param"; names: string[] }
  | { kind: "coercion-failed"; name: string; from: string; to: string }
  | { kind: "criteria-undocumented"; paramName: string; rootKey: string; leafPath: string };

export function reprojectFormState(
  oldState: FormState,
  _oldSchema: EndpointSchema,
  newSchema: EndpointSchema,
): { nextState: FormState; warnings: MigrationWarning[] } {
  const warnings: MigrationWarning[] = [];
  const nextState: FormState = {
    pathParams: {},
    queryParams: {},
    criteria: {},
    headers: [...oldState.headers],
    body: { ...oldState.body },
    headersOverridden: { ...oldState.headersOverridden },
    orphans: {},
  };

  const paramsByName = new Map<string, OpenAPIParameter>();
  for (const p of newSchema.parameters) paramsByName.set(p.name, p);

  // Path params
  const orphanPathNames: string[] = [];
  for (const [name, value] of Object.entries(oldState.pathParams)) {
    const newParam = paramsByName.get(name);
    if (newParam && newParam.in === "path") {
      const { kept, failedCoercion } = tryCoerce(value, newParam.schema?.type);
      if (failedCoercion) warnings.push({ kind: "coercion-failed", name, from: "string", to: newParam.schema!.type! });
      nextState.pathParams[name] = kept;
    } else {
      orphanPathNames.push(name);
      (nextState.orphans!.pathParams ??= {})[name] = value;
    }
  }
  if (orphanPathNames.length) warnings.push({ kind: "orphan-path-param", names: orphanPathNames });

  // Query params
  const orphanQueryNames: string[] = [];
  const newCriteriaNames = new Set(
    newSchema.parameters.filter(isCriteriaParam).map((p) => p.name),
  );
  for (const [name, value] of Object.entries(oldState.queryParams)) {
    if (newCriteriaNames.has(name)) continue; // criteria-shaped, handled below
    const newParam = paramsByName.get(name);
    if (newParam && newParam.in === "query") {
      const { kept, failedCoercion } = tryCoerce(value, newParam.schema?.type);
      if (failedCoercion) warnings.push({ kind: "coercion-failed", name, from: "string", to: newParam.schema!.type! });
      nextState.queryParams[name] = kept;
    } else {
      orphanQueryNames.push(name);
      (nextState.orphans!.queryParams ??= {})[name] = value;
    }
  }
  if (orphanQueryNames.length) warnings.push({ kind: "orphan-query-param", names: orphanQueryNames });

  // Criteria chips — preserved per-param.  If the new version dropped the
  // param entirely, the old chips spill into orphans.criteria so nothing is
  // silently lost on version change.
  const newCriteriaByName = new Map<string, OpenAPIParameter>();
  for (const p of newSchema.parameters) if (isCriteriaParam(p)) newCriteriaByName.set(p.name, p);

  for (const [paramName, perParam] of Object.entries(oldState.criteria)) {
    const newParam = newCriteriaByName.get(paramName);
    if (!newParam) {
      (nextState.orphans!.criteria ??= {})[paramName] = perParam;
      continue;
    }
    nextState.criteria[paramName] = {};
    for (const [rootKey, leaves] of Object.entries(perParam)) {
      nextState.criteria[paramName][rootKey] = { ...leaves };
    }
    const extracted = scrapeCriteriaFilters(
      newParam.description ?? "",
      newParam.name,
      typeof newParam.example === "string" ? newParam.example : undefined,
    );
    const documentedKeys = new Set(extracted.map((f) => `${f.rootKey}.${f.leafPath}`));
    for (const [rootKey, leaves] of Object.entries(perParam)) {
      for (const leafPath of Object.keys(leaves)) {
        if (!documentedKeys.has(`${rootKey}.${leafPath}`)) {
          warnings.push({ kind: "criteria-undocumented", paramName, rootKey, leafPath });
        }
      }
    }
  }

  return { nextState, warnings };
}

function tryCoerce(
  value: string,
  targetType: string | undefined,
): { kept: string; failedCoercion: boolean } {
  if (!targetType || targetType === "string") return { kept: value, failedCoercion: false };
  if (targetType === "integer" || targetType === "number") {
    return { kept: value, failedCoercion: Number.isNaN(Number(value)) };
  }
  if (targetType === "boolean") {
    return { kept: value, failedCoercion: !/^(true|false)$/i.test(value) };
  }
  return { kept: value, failedCoercion: false };
}
