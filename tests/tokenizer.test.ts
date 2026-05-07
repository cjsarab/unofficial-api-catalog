import { describe, test, expect } from "vitest";
import {
  tokenizeReferenceObject,
  tokenizeLookupReferenceObject,
  type LineageToken,
} from "../server/indexer/tokenizer.ts";

function columns(result: { tokens: LineageToken[] }) {
  return result.tokens.filter((t) => t.kind === "column").map((t) => t.value);
}

function tables(result: { tokens: LineageToken[] }) {
  return result.tokens.filter((t) => t.kind === "table").map((t) => t.value);
}

describe("tokenizeReferenceObject — sentinels", () => {
  test("unsupported", () => {
    const r = tokenizeReferenceObject("unsupported");
    expect(r.sentinel).toBe("unsupported");
    expect(r.tokens).toHaveLength(0);
  });
  test("derived", () => {
    const r = tokenizeReferenceObject("derived");
    expect(r.sentinel).toBe("derived");
  });
  test("caseInsensitiveRg (search marker)", () => {
    const r = tokenizeReferenceObject("caseInsensitiveRg");
    expect(r.sentinel).toBe("caseInsensitiveRg");
  });
  test("unsupported with trailing whitespace", () => {
    const r = tokenizeReferenceObject("unsupported  ");
    expect(r.sentinel).toBe("unsupported");
  });
});

describe("tokenizeReferenceObject — bare columns", () => {
  test("Banner bare column", () => {
    const r = tokenizeReferenceObject("SPRIDEN_ID");
    expect(columns(r)).toEqual(["SPRIDEN_ID"]);
    expect(r.tokens[0]!.sourceSystemHint).toBe("banner");
  });
  test("Colleague bare column", () => {
    const r = tokenizeReferenceObject("FA.YEAR");
    expect(columns(r)).toEqual(["FA.YEAR"]);
    expect(r.tokens[0]!.sourceSystemHint).toBe("colleague");
  });
  test("Colleague 3-part column", () => {
    const r = tokenizeReferenceObject("VAL.EXTERNAL.REPRESENTATION");
    expect(columns(r)).toEqual(["VAL.EXTERNAL.REPRESENTATION"]);
  });
  test("leading whitespace does not break extraction", () => {
    const r = tokenizeReferenceObject(" PLD.HOURS");
    expect(columns(r)).toEqual(["PLD.HOURS"]);
  });
});

describe("tokenizeReferenceObject — table-qualified columns", () => {
  test("Colleague X(TABLE)", () => {
    const r = tokenizeReferenceObject("CAT.DESC(CATALOGS)");
    const col = r.tokens.find((t) => t.kind === "column");
    expect(col?.value).toBe("CAT.DESC");
    expect(col?.qualifiedTable).toBe("CATALOGS");
    expect(tables(r)).toContain("CATALOGS");
  });
  test("Banner X(TABLE)", () => {
    const r = tokenizeReferenceObject("GTVLGSX_GUID(GTVLGSX)");
    const col = r.tokens.find((t) => t.kind === "column");
    expect(col?.value).toBe("GTVLGSX_GUID");
    expect(col?.qualifiedTable).toBe("GTVLGSX");
    expect(tables(r)).toContain("GTVLGSX");
  });
});

describe("tokenizeReferenceObject — alternatives via 'or'", () => {
  test("two Colleague alternatives", () => {
    const r = tokenizeReferenceObject("LDM.GUID.ID(OTHER.DEGREES) or LDM.GUID.ID(OTHER.CCDS)");
    expect(columns(r)).toEqual(["LDM.GUID.ID", "LDM.GUID.ID"]);
    expect(tables(r).sort()).toEqual(["OTHER.CCDS", "OTHER.DEGREES"]);
  });
  test("three Banner alternatives + parenthesised concat", () => {
    const r = tokenizeReferenceObject(
      "STVACYR_CODE(STVACYR) or STVPTRM_CODE(STVPTRM) or STVTERM_CODE(STVTERM) or (SOBODTE_TERM_CODE||'(OLR)'||SOBODTE_INSM_CODE)",
    );
    expect(columns(r).sort()).toEqual([
      "SOBODTE_INSM_CODE",
      "SOBODTE_TERM_CODE",
      "STVACYR_CODE",
      "STVPTRM_CODE",
      "STVTERM_CODE",
    ]);
    expect(tables(r).sort()).toEqual(["STVACYR", "STVPTRM", "STVTERM"]);
  });
});

describe("tokenizeReferenceObject — where clauses", () => {
  test("simple where", () => {
    const r = tokenizeReferenceObject(
      "STVBLDG_DESC(STVBLDG) where SLBBLDG_BLDG_CODE = STVBLDG_CODE",
    );
    expect(columns(r).sort()).toEqual([
      "SLBBLDG_BLDG_CODE",
      "STVBLDG_CODE",
      "STVBLDG_DESC",
    ]);
    expect(tables(r)).toEqual(["STVBLDG"]);
  });
  test("where with literal (CEEB)", () => {
    const r = tokenizeReferenceObject(
      "STVSBGI_CODE(STVSBGI) or STVSBGI_FICE(STVSBGI) or GORSBGT_VALUE(GORSBGT) field where GORSBGT_SBGT_CODE='CEEB'",
    );
    expect(columns(r).sort()).toEqual([
      "GORSBGT_SBGT_CODE",
      "GORSBGT_VALUE",
      "STVSBGI_CODE",
      "STVSBGI_FICE",
    ]);
    // 'CEEB' is a literal, not a column
    expect(columns(r)).not.toContain("CEEB");
  });
  test("where with persons example from the user", () => {
    const r = tokenizeReferenceObject(
      "GTVLGSX_GUID(GTVLGSX) where SPBPERS_SEX = GTVLGSX_CODE",
    );
    expect(columns(r).sort()).toEqual(["GTVLGSX_CODE", "GTVLGSX_GUID", "SPBPERS_SEX"]);
    expect(tables(r)).toEqual(["GTVLGSX"]);
  });
});

describe("tokenizeReferenceObject — concatenation", () => {
  test("|| concat with string literal", () => {
    const r = tokenizeReferenceObject("(SOBODTE_TERM_CODE||'(OLR)'||SOBODTE_INSM_CODE)");
    expect(columns(r).sort()).toEqual(["SOBODTE_INSM_CODE", "SOBODTE_TERM_CODE"]);
    // '(OLR)' inside single quotes must not be misread as a column or table
    expect(columns(r)).not.toContain("OLR");
    expect(tables(r)).not.toContain("OLR");
  });
});

describe("tokenizeReferenceObject — tuples and informal text", () => {
  test("tuple of Colleague columns", () => {
    const r = tokenizeReferenceObject("(CONTACT.ACTUAL.DATE, CONTACT.ACTUAL.TIME)");
    expect(columns(r).sort()).toEqual(["CONTACT.ACTUAL.DATE", "CONTACT.ACTUAL.TIME"]);
  });
  test("unbalanced paren tuple", () => {
    const r = tokenizeReferenceObject("CSM.START.DATE, CSM.START.TIME)");
    expect(columns(r).sort()).toEqual(["CSM.START.DATE", "CSM.START.TIME"]);
  });
  test("informal text with 'etc'", () => {
    const r = tokenizeReferenceObject("CSM.MONDAY, etc)");
    expect(columns(r)).toEqual(["CSM.MONDAY"]);
    // 'etc' is informal noise, must not be emitted
    expect(columns(r)).not.toContain("etc");
    expect(tables(r)).not.toContain("etc");
  });
});

describe("tokenizeReferenceObject — edge cases", () => {
  test("empty / nullish", () => {
    expect(tokenizeReferenceObject("").tokens).toHaveLength(0);
    expect(tokenizeReferenceObject(null).tokens).toHaveLength(0);
    expect(tokenizeReferenceObject(undefined).tokens).toHaveLength(0);
  });
  test("non-string passes through", () => {
    // numbers, booleans, objects — we tokenize after String()
    const r = tokenizeReferenceObject(42);
    expect(r.tokens).toHaveLength(0);
  });
  test("preserves raw", () => {
    const r = tokenizeReferenceObject("  SPRIDEN_ID  ");
    expect(r.raw).toBe("  SPRIDEN_ID  ");
  });
  test("does not tokenize lowercase or camelCase words", () => {
    // These are not DB-style identifiers; ignore.
    const r = tokenizeReferenceObject("someCamelCase or lowercase");
    expect(r.tokens).toHaveLength(0);
  });
});

describe("tokenizeLookupReferenceObject", () => {
  test("EEDM api-resource-style name", () => {
    const r = tokenizeLookupReferenceObject("educational-institutions");
    expect(r.reference).toBe("educational-institutions");
    expect(r.guessedKind).toBe("api-resource");
  });
  test("Banner validation table name", () => {
    const r = tokenizeLookupReferenceObject("gtvzipc");
    expect(r.reference).toBe("gtvzipc");
    expect(r.guessedKind).toBe("db-table");
  });
  test("Banner stvnatn table name", () => {
    const r = tokenizeLookupReferenceObject("stvnatn");
    expect(r.reference).toBe("stvnatn");
    expect(r.guessedKind).toBe("db-table");
  });
  test("multi-word hyphenated is an api resource", () => {
    const r = tokenizeLookupReferenceObject("academic-programs");
    expect(r.guessedKind).toBe("api-resource");
  });
  test("uppercase Banner table (STVTERM)", () => {
    const r = tokenizeLookupReferenceObject("STVTERM");
    expect(r.guessedKind).toBe("db-table");
  });
  test("Colleague dotted table name", () => {
    const r = tokenizeLookupReferenceObject("OTHER.DEGREES");
    expect(r.guessedKind).toBe("db-table");
  });
  test("nullish is inert", () => {
    expect(tokenizeLookupReferenceObject(null).reference).toBeUndefined();
    expect(tokenizeLookupReferenceObject("").reference).toBeUndefined();
  });
});
