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
