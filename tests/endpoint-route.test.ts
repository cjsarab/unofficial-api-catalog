import { describe, expect, test } from "vitest";
import { extractEndpoint } from "../server/routes/endpoint.ts";

const SPEC_YAML = `
openapi: 3.0.0
info:
  title: Persons
  version: "12.7.0"
paths:
  /persons:
    get:
      summary: List persons
      description: Returns all person records.
      parameters:
        - name: limit
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 500 }
        - name: criteria
          in: query
          required: false
          schema: { type: object }
          description: |
            ### First Name
            /persons?criteria={"names":[{"firstName":"James"}]}
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { type: array, items: { type: object } }
    post:
      summary: Create person
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                id: { type: string, format: uuid }
                firstName: { type: string }
      responses:
        '201': { description: Created }
  /persons/{guid}:
    get:
      summary: Get one person
      parameters:
        - name: guid
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200': { description: OK }
`;

describe("extractEndpoint", () => {
  test("returns the GET /persons operation with parameters and responses", () => {
    const result = extractEndpoint(SPEC_YAML, "GET", "/persons");
    expect(result).not.toBeNull();
    expect(result!.method).toBe("GET");
    expect(result!.path).toBe("/persons");
    expect(result!.summary).toBe("List persons");
    expect(result!.parameters).toHaveLength(2);
    expect(result!.parameters[0]!.name).toBe("limit");
    expect(result!.parameters[0]!.schema?.type).toBe("integer");
    expect(result!.parameters[1]!.name).toBe("criteria");
    expect(result!.responses["200"]).toBeDefined();
  });

  test("returns the POST /persons operation with requestBody", () => {
    const result = extractEndpoint(SPEC_YAML, "POST", "/persons");
    expect(result).not.toBeNull();
    expect(result!.requestBody).not.toBeNull();
    expect(result!.requestBody!.required).toBe(true);
    expect(result!.requestBody!.content["application/json"]?.schema?.properties?.firstName?.type).toBe("string");
  });

  test("returns path param for GET /persons/{guid}", () => {
    const result = extractEndpoint(SPEC_YAML, "GET", "/persons/{guid}");
    expect(result).not.toBeNull();
    expect(result!.parameters).toHaveLength(1);
    expect(result!.parameters[0]!.name).toBe("guid");
    expect(result!.parameters[0]!.in).toBe("path");
    expect(result!.parameters[0]!.schema?.format).toBe("uuid");
  });

  test("method case-insensitive on input", () => {
    expect(extractEndpoint(SPEC_YAML, "get", "/persons")).not.toBeNull();
    expect(extractEndpoint(SPEC_YAML, "Get", "/persons")).not.toBeNull();
  });

  test("unknown path returns null", () => {
    expect(extractEndpoint(SPEC_YAML, "GET", "/not-a-real-path")).toBeNull();
  });

  test("unknown method returns null", () => {
    expect(extractEndpoint(SPEC_YAML, "PATCH", "/persons")).toBeNull();
  });

  test("malformed YAML throws with a helpful message", () => {
    expect(() => extractEndpoint("this is :: not : yaml ::: at all", "GET", "/x")).toThrow();
  });
});

// $ref resolution — the Ellucian Bus pattern: request body is a $ref to a
// component schema. Without this, the Try panel's "Insert Skeleton" button
// would output literal `null` because buildSkeleton can't see through a ref.
const REF_SPEC = `
openapi: 3.0.0
info: { title: Refs, version: "1.0.0" }
paths:
  /thing:
    post:
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Thing_post_request"
      responses:
        '201': { description: Created }
  /nested:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [child]
              properties:
                child:
                  $ref: "#/components/schemas/Child"
                grand:
                  type: array
                  items:
                    $ref: "#/components/schemas/Child"
      responses:
        '201': { description: Created }
  /allof:
    post:
      requestBody:
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/Base"
                - type: object
                  properties:
                    extra: { type: string }
      responses:
        '201': { description: Created }
  /cycle:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Loop"
      responses:
        '201': { description: Created }
  /missing:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DoesNotExist"
      responses:
        '201': { description: Created }
components:
  schemas:
    Thing_post_request:
      type: object
      required: [id, name]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
    Child:
      type: object
      required: [code]
      properties:
        code: { type: string }
    Base:
      type: object
      required: [baseField]
      properties:
        baseField: { type: integer }
    Loop:
      type: object
      properties:
        next:
          $ref: "#/components/schemas/Loop"
`;

describe("extractEndpoint $ref resolution", () => {
  function getSchema(method: string, path: string): unknown {
    const r = extractEndpoint(REF_SPEC, method, path);
    expect(r).not.toBeNull();
    return r!.requestBody!.content!["application/json"]!.schema as unknown;
  }

  test("simple top-level $ref is replaced with the component schema", () => {
    const schema = getSchema("POST", "/thing") as Record<string, unknown>;
    expect(schema["$ref"]).toBeUndefined();
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["id", "name"]);
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual(["id", "name"]);
  });

  test("nested $ref inside properties and inside array items both resolve", () => {
    const schema = getSchema("POST", "/nested") as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    // properties.child was a $ref → now an object schema
    expect(props.child!["$ref"]).toBeUndefined();
    expect(props.child!.type).toBe("object");
    expect((props.child!.properties as Record<string, unknown>).code).toBeDefined();
    // properties.grand.items was a $ref → also resolved
    const items = (props.grand!.items as Record<string, unknown>);
    expect(items["$ref"]).toBeUndefined();
    expect(items.type).toBe("object");
  });

  test("allOf with a $ref entry resolves that entry while preserving siblings", () => {
    const schema = getSchema("POST", "/allof") as Record<string, unknown>;
    const all = schema.allOf as Array<Record<string, unknown>>;
    expect(all).toHaveLength(2);
    // First entry was a $ref to Base — now inlined
    expect(all[0]!["$ref"]).toBeUndefined();
    expect(all[0]!.type).toBe("object");
    expect(all[0]!.required).toEqual(["baseField"]);
    // Second entry was already inline — unchanged
    expect((all[1]!.properties as Record<string, unknown>).extra).toBeDefined();
  });

  test("self-referential schemas terminate without infinite recursion", () => {
    const schema = getSchema("POST", "/cycle") as Record<string, unknown>;
    // Top-level resolves to the Loop schema; the inner `next` ref hits the
    // visited set and is left as a $ref node rather than expanding forever.
    expect(schema.type).toBe("object");
    const next = (schema.properties as Record<string, Record<string, unknown>>).next;
    expect(next!["$ref"]).toBe("#/components/schemas/Loop");
  });

  test("unresolvable $ref is left as-is (no crash, no silent loss)", () => {
    const schema = getSchema("POST", "/missing") as Record<string, unknown>;
    expect(schema["$ref"]).toBe("#/components/schemas/DoesNotExist");
  });

  test("schemas with no $refs pass through unchanged", () => {
    // The original SPEC_YAML POST body has no refs — should still work.
    const result = extractEndpoint(SPEC_YAML, "POST", "/persons");
    const schema = result!.requestBody!.content!["application/json"]!.schema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect((schema.properties as Record<string, unknown>).firstName).toBeDefined();
  });
});
