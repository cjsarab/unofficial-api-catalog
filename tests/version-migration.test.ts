import { describe, expect, test } from "vitest";
import { reprojectFormState, type FormState } from "../web/docs/try/version-migration.ts";
import type { EndpointSchema, OpenAPIParameter } from "../web/lib/openapi.ts";

function schema(parameters: OpenAPIParameter[], extras: Partial<EndpointSchema> = {}): EndpointSchema {
  return {
    method: "GET", path: "/persons", summary: null, description: null,
    parameters, requestBody: null, responses: {},
    ...extras,
  };
}

function emptyState(): FormState {
  return {
    pathParams: {}, queryParams: {}, criteria: {},
    headers: [], body: { mode: "raw", text: "" }, headersOverridden: {},
  };
}

describe("version migration", () => {
  test("same name + same type → value carried over", () => {
    const s1 = schema([{ name: "lastName", in: "query", schema: { type: "string" } }]);
    const s2 = schema([{ name: "lastName", in: "query", schema: { type: "string" } }]);
    const state: FormState = { ...emptyState(), queryParams: { lastName: "Abbot" } };
    const { nextState, warnings } = reprojectFormState(state, s1, s2);
    expect(nextState.queryParams).toEqual({ lastName: "Abbot" });
    expect(warnings).toEqual([]);
  });

  test("missing field in new version → orphan warning, value preserved in orphans bucket", () => {
    const s1 = schema([
      { name: "lastName", in: "query", schema: { type: "string" } },
      { name: "lastNamePrefix", in: "query", schema: { type: "string" } },
    ]);
    const s2 = schema([
      { name: "lastName", in: "query", schema: { type: "string" } },
    ]);
    const state: FormState = {
      ...emptyState(),
      queryParams: { lastName: "Abbot", lastNamePrefix: "Van" },
    };
    const { nextState, warnings } = reprojectFormState(state, s1, s2);
    expect(nextState.queryParams).toEqual({ lastName: "Abbot" });
    expect(nextState.orphans?.queryParams).toEqual({ lastNamePrefix: "Van" });
    expect(warnings).toContainEqual(expect.objectContaining({
      kind: "orphan-query-param",
      names: ["lastNamePrefix"],
    }));
  });

  test("type change (string → integer) attempts coercion, succeeds for numeric string", () => {
    const s1 = schema([{ name: "limit", in: "query", schema: { type: "string" } }]);
    const s2 = schema([{ name: "limit", in: "query", schema: { type: "integer" } }]);
    const state: FormState = { ...emptyState(), queryParams: { limit: "10" } };
    const { nextState, warnings } = reprojectFormState(state, s1, s2);
    expect(nextState.queryParams).toEqual({ limit: "10" });
    expect(warnings).toEqual([]);
  });

  test("type change → coercion fails, value kept, warning surfaced", () => {
    const s1 = schema([{ name: "limit", in: "query", schema: { type: "string" } }]);
    const s2 = schema([{ name: "limit", in: "query", schema: { type: "integer" } }]);
    const state: FormState = { ...emptyState(), queryParams: { limit: "not-a-number" } };
    const { nextState, warnings } = reprojectFormState(state, s1, s2);
    expect(nextState.queryParams.limit).toBe("not-a-number");
    expect(warnings).toContainEqual(expect.objectContaining({
      kind: "coercion-failed",
      name: "limit",
    }));
  });

  test("criteria chip kept even when leafPath not in new extracted filters, tagged undocumented", () => {
    const s1 = schema([{ name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"names":[{"firstName":"X"}]}` }]);
    const s2 = schema([{ name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"roles":[{"role":"Y"}]}` }]);
    const state: FormState = { ...emptyState(), criteria: { criteria: { names: { firstName: "James" } } } };
    const { nextState, warnings } = reprojectFormState(state, s1, s2);
    expect(nextState.criteria).toEqual({ criteria: { names: { firstName: "James" } } });
    expect(warnings).toContainEqual(expect.objectContaining({
      kind: "criteria-undocumented",
      paramName: "criteria",
      rootKey: "names",
      leafPath: "firstName",
    }));
  });

  test("multiple object-type query params each preserved in their own bucket", () => {
    const s1 = schema([
      { name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"names":[{"firstName":"X"}]}` },
      { name: "personFilter", in: "query", schema: { type: "object" }, description: `?personFilter={"personFilter":"Y"}` },
    ]);
    const s2 = schema([
      { name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"names":[{"firstName":"X"}]}` },
      { name: "personFilter", in: "query", schema: { type: "object" }, description: `?personFilter={"personFilter":"Y"}` },
    ]);
    const state: FormState = {
      ...emptyState(),
      criteria: {
        criteria: { names: { firstName: "James" } },
        personFilter: { personFilter: { personFilter: "abc-123" } },
      },
    };
    const { nextState } = reprojectFormState(state, s1, s2);
    expect(nextState.criteria.criteria).toEqual({ names: { firstName: "James" } });
    expect(nextState.criteria.personFilter).toEqual({ personFilter: { personFilter: "abc-123" } });
  });

  test("criteriaRaw override carried over when the param still exists in the new schema", () => {
    const s1 = schema([{ name: "sort", in: "query", schema: { type: "object" } }]);
    const s2 = schema([{ name: "sort", in: "query", schema: { type: "object" } }]);
    const state: FormState = {
      ...emptyState(),
      criteria: { sort: { asc: { asc: "lastName" } } },
      criteriaRaw: { sort: '{"asc": "lastName"}' },
    };
    const { nextState } = reprojectFormState(state, s1, s2);
    expect(nextState.criteriaRaw?.sort).toBe('{"asc": "lastName"}');
  });

  test("object-type query param dropped from new schema → criteria spills into orphans bucket", () => {
    const s1 = schema([
      { name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"names":[{"firstName":"X"}]}` },
      { name: "personFilter", in: "query", schema: { type: "object" }, description: `?personFilter={"personFilter":"Y"}` },
    ]);
    const s2 = schema([
      { name: "criteria", in: "query", schema: { type: "object" }, description: `?criteria={"names":[{"firstName":"X"}]}` },
    ]);
    const state: FormState = {
      ...emptyState(),
      criteria: {
        criteria: { names: { firstName: "James" } },
        personFilter: { personFilter: { personFilter: "abc-123" } },
      },
    };
    const { nextState } = reprojectFormState(state, s1, s2);
    expect(nextState.criteria.criteria).toEqual({ names: { firstName: "James" } });
    expect(nextState.criteria.personFilter).toBeUndefined();
    expect(nextState.orphans?.criteria?.personFilter).toEqual({ personFilter: { personFilter: "abc-123" } });
  });

  test("body text preserved verbatim across schema change (Raw mode)", () => {
    const s1 = schema([], { requestBody: { content: { "application/json": { schema: { type: "object" } } } } });
    const s2 = schema([], { requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } });
    const state: FormState = { ...emptyState(), body: { mode: "raw", text: `{"oldField":"x"}` } };
    const { nextState } = reprojectFormState(state, s1, s2);
    expect(nextState.body).toEqual({ mode: "raw", text: `{"oldField":"x"}` });
  });

  test("overridden headers kept on version change", () => {
    const s1 = schema([]); const s2 = schema([]);
    const state: FormState = {
      ...emptyState(),
      headers: [{ name: "Accept", value: "application/vnd.hedtech.integration.v11+json" }],
      headersOverridden: { Accept: true },
    };
    const { nextState } = reprojectFormState(state, s1, s2);
    expect(nextState.headers).toEqual([{ name: "Accept", value: "application/vnd.hedtech.integration.v11+json" }]);
    expect(nextState.headersOverridden).toEqual({ Accept: true });
  });
});
