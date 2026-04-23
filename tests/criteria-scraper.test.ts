import { describe, expect, test } from "bun:test";
import { scrapeCriteriaFilters, type ExtractedFilter } from "../web/lib/criteria-scraper.ts";

describe("criteria scraper", () => {
  test("empty description returns empty array", () => {
    expect(scrapeCriteriaFilters("", "criteria")).toEqual([]);
  });

  test("extracts a single leaf from an array-of-objects root", () => {
    const desc = `
      ### First Name
      /persons?criteria={"names":[{"firstName":"James"}]}
    `;
    const filters = scrapeCriteriaFilters(desc, "criteria");
    expect(filters).toEqual([
      { rootKey: "names", leafPath: "firstName", label: "First Name", fullPath: ["names", "0", "firstName"] },
    ] satisfies ExtractedFilter[]);
  });

  test("dedupes identical leaves across multiple URL examples", () => {
    const desc = `
      /persons?criteria={"names":[{"firstName":"James"}]}
      /persons?criteria={"names":[{"firstName":"John"}]}
    `;
    const filters = scrapeCriteriaFilters(desc, "criteria");
    expect(filters).toHaveLength(1);
    expect(filters[0]!.leafPath).toBe("firstName");
  });

  test("extracts multiple leaves from the same root", () => {
    const desc = `/persons?criteria={"credentials":[{"type":"bannerId","value":"A00000718"}]}`;
    const filters = scrapeCriteriaFilters(desc, "criteria");
    expect(filters.map((f) => f.leafPath).sort()).toEqual(["type", "value"]);
    expect(filters.every((f) => f.rootKey === "credentials")).toBe(true);
  });

  test("extracts across multiple root keys", () => {
    const desc = `
      /persons?criteria={"names":[{"firstName":"James"}]}
      /persons?criteria={"roles":[{"role":"instructor"}]}
      /persons?criteria={"emails":[{"address":"x@y.com"}]}
    `;
    const filters = scrapeCriteriaFilters(desc, "criteria");
    expect(filters.map((f) => f.rootKey).sort()).toEqual(["emails", "names", "roles"]);
  });

  test("handles malformed JSON block without crashing", () => {
    const desc = `
      Broken: /persons?criteria={"names":[{"firstName":"no-close-brace"
      Works: /persons?criteria={"roles":[{"role":"admin"}]}
    `;
    const filters = scrapeCriteriaFilters(desc, "criteria");
    expect(filters).toHaveLength(1);
    expect(filters[0]!.rootKey).toBe("roles");
  });

  test("camelCase leaf converts to Title Case label", () => {
    const desc = `/persons?criteria={"names":[{"lastNamePrefix":"Van"}]}`;
    const [f] = scrapeCriteriaFilters(desc, "criteria");
    expect(f!.label).toBe("Last Name Prefix");
  });

  test("single-word leaf is Title-Cased", () => {
    const desc = `/persons?criteria={"roles":[{"role":"admin"}]}`;
    const [f] = scrapeCriteriaFilters(desc, "criteria");
    expect(f!.label).toBe("Role");
  });

  test("scalar-valued root yields the root as the leaf", () => {
    const desc = `/persons?personFilter={"personFilter":"00000000-0000-0000-0000-000000000001"}`;
    const filters = scrapeCriteriaFilters(desc, "personFilter");
    expect(filters).toEqual([
      { rootKey: "personFilter", leafPath: "personFilter", label: "Person Filter", fullPath: ["personFilter"] },
    ]);
  });

  test("scraping only sees blocks matching the given paramName", () => {
    const desc = `
      /persons?criteria={"names":[{"firstName":"James"}]}
      /persons?personFilter={"personFilter":"xxx"}
    `;
    const criteriaFilters = scrapeCriteriaFilters(desc, "criteria");
    expect(criteriaFilters.map((f) => f.leafPath)).toEqual(["firstName"]);
    const pfFilters = scrapeCriteriaFilters(desc, "personFilter");
    expect(pfFilters).toHaveLength(1);
    expect(pfFilters[0]!.leafPath).toBe("personFilter");
  });

  test("example string is also scraped when provided", () => {
    const filters = scrapeCriteriaFilters("", "criteria", '{"names":[{"firstName":"Ada"}]}');
    expect(filters).toHaveLength(1);
    expect(filters[0]!.leafPath).toBe("firstName");
  });
});
