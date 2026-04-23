import type { EndpointSchema, OpenAPIParameter } from "../../lib/openapi.ts";
import { scrapeCriteriaFilters } from "../../lib/criteria-scraper.ts";

export interface FormState {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  /** Flattened criteria values keyed by rootKey → leafName. */
  criteria: Record<string, Record<string, string>>;
  headers: Array<{ name: string; value: string }>;
  body: { mode: "form" | "raw"; text: string };
  /** Names the user explicitly overrode (don't auto-recompute on version change). */
  headersOverridden: Record<string, boolean>;
  /** Fields that used to exist but don't in the current version — preserved verbatim. */
  orphans?: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    criteria?: Record<string, Record<string, string>>;
  };
}

export type MigrationWarning =
  | { kind: "orphan-path-param"; names: string[] }
  | { kind: "orphan-query-param"; names: string[] }
  | { kind: "coercion-failed"; name: string; from: string; to: string }
  | { kind: "criteria-undocumented"; rootKey: string; leafPath: string };

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
    newSchema.parameters.filter((p) => p.in === "query" && p.schema?.type === "object").map((p) => p.name),
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

  // Criteria chips
  for (const [rootKey, leaves] of Object.entries(oldState.criteria)) {
    nextState.criteria[rootKey] = { ...leaves };
    // Check whether the new version's criteria description still documents these leaves.
    const criteriaParam = newSchema.parameters.find((p) => p.schema?.type === "object" && p.name === findCriteriaParamName(newSchema));
    if (!criteriaParam) continue;
    const extracted = scrapeCriteriaFilters(
      criteriaParam.description ?? "",
      criteriaParam.name,
      typeof criteriaParam.example === "string" ? criteriaParam.example : undefined,
    );
    const documentedKeys = new Set(extracted.map((f) => `${f.rootKey}.${f.leafPath}`));
    for (const leafPath of Object.keys(leaves)) {
      if (!documentedKeys.has(`${rootKey}.${leafPath}`)) {
        warnings.push({ kind: "criteria-undocumented", rootKey, leafPath });
      }
    }
  }

  return { nextState, warnings };
}

function findCriteriaParamName(schema: EndpointSchema): string | undefined {
  // First object-typed query param with a non-empty description is the one
  // the scraper will treat as criteria. Matches how TryPanel chooses.
  const p = schema.parameters.find((q) => q.in === "query" && q.schema?.type === "object" && q.description);
  return p?.name;
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
