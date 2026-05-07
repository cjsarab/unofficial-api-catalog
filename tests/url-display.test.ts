import { describe, expect, test } from "bun:test";
import { decodeQueryValues, pathOnly } from "../web/lib/url-display.ts";

describe("decodeQueryValues", () => {
  test("returns the URL unchanged when there is no query string", () => {
    expect(decodeQueryValues("/api/persons")).toBe("/api/persons");
    expect(decodeQueryValues("https://example.com/foo")).toBe("https://example.com/foo");
  });

  test("decodes a JSON-shaped criteria value while leaving the structure intact", () => {
    const encoded = "/api/persons?criteria=%7B%22names%22%3A%5B%7B%22firstName%22%3A%22James%22%7D%5D%7D";
    expect(decodeQueryValues(encoded)).toBe(`/api/persons?criteria={"names":[{"firstName":"James"}]}`);
  });

  test("preserves the & between params and decodes each value", () => {
    const encoded = "/api/persons?criteria=%7B%22a%22%3A1%7D&personFilter=%7B%22id%22%3A%22abc%22%7D";
    expect(decodeQueryValues(encoded)).toBe(`/api/persons?criteria={"a":1}&personFilter={"id":"abc"}`);
  });

  test("leaves structural ? % &  characters in the BASE alone", () => {
    expect(decodeQueryValues("/api/foo%2Fbar")).toBe("/api/foo%2Fbar");
  });

  test("malformed percent-encoding is left as-is rather than throwing", () => {
    expect(decodeQueryValues("/api/x?bad=%E0%A4")).toBe("/api/x?bad=%E0%A4");
  });

  test("empty value after = is preserved", () => {
    expect(decodeQueryValues("/api/x?empty=&other=hi")).toBe("/api/x?empty=&other=hi");
  });

  test("flag-style param (no =) is preserved", () => {
    expect(decodeQueryValues("/api/x?bareflag&other=v")).toBe("/api/x?bareflag&other=v");
  });
});

describe("pathOnly", () => {
  test("strips https://host", () => {
    expect(pathOnly("https://integrate.elluciancloud.com/api/persons?x=1")).toBe("/api/persons?x=1");
  });

  test("strips http://host:port", () => {
    expect(pathOnly("http://localhost:5757/api/foo")).toBe("/api/foo");
  });

  test("keeps a path-only URL unchanged", () => {
    expect(pathOnly("/api/persons?x=1")).toBe("/api/persons?x=1");
  });

  test("returns empty input unchanged", () => {
    expect(pathOnly("")).toBe("");
  });
});
