import { describe, it, expect } from "bun:test";
import { parsePeppolAddress } from "../utils/parsing/peppol-address";
import {
  validateCountryIdentifier,
  validateIdentifier,
} from "../utils/identifier-validation";

describe("parsePeppolAddress", () => {
  it("splits scheme and identifier", () => {
    expect(parsePeppolAddress("0208:0428643097")).toEqual({
      schemeId: "0208",
      identifier: "0428643097",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePeppolAddress(" 0208 : 0428643097 ")).toEqual({
      schemeId: "0208",
      identifier: "0428643097",
    });
  });

  it("uppercases a Danish CVR identifier so it satisfies PEPPOL-COMMON-R042", () => {
    expect(parsePeppolAddress("0184:dk12345678").identifier).toBe("DK12345678");
  });

  it("uppercases a Dutch VAT identifier", () => {
    expect(parsePeppolAddress("9944:nl123456789b01").identifier).toBe(
      "NL123456789B01"
    );
  });

  it("leaves numeric identifiers untouched", () => {
    expect(parsePeppolAddress("0088:5790000435951").identifier).toBe(
      "5790000435951"
    );
  });

  it("throws on a malformed address", () => {
    expect(() => parsePeppolAddress("0208")).toThrow();
    expect(() => parsePeppolAddress("0208:1:2")).toThrow();
  });
});

describe("validateIdentifier for Danish CVR (0184)", () => {
  it("accepts 8 digits", () => {
    expect(() => validateIdentifier("0184", "12345678")).not.toThrow();
  });

  it("accepts a DK prefix in either case", () => {
    expect(() => validateIdentifier("0184", "DK12345678")).not.toThrow();
    expect(() => validateIdentifier("0184", "dk12345678")).not.toThrow();
  });

  it("rejects the wrong number of digits", () => {
    expect(() => validateIdentifier("0184", "1234567")).toThrow();
    expect(() => validateIdentifier("0184", "DK1234567")).toThrow();
  });

  it("rejects another country's prefix", () => {
    expect(() => validateIdentifier("0184", "SE12345678")).toThrow();
  });

  it("rejects separators, which survive cleanIdentifier and would fail R042", () => {
    expect(() => validateIdentifier("0184", "DK-12345678")).toThrow();
    expect(() => validateIdentifier("0184", "1234.5678")).toThrow();
  });
});

// 303265045 is a well formed SIREN and 30326504500011 a well formed SIRET of it.
describe("validateIdentifier for French electronic addresses (0225)", () => {
  it("accepts the SIREN of a company and the SIRET of an establishment", () => {
    expect(() => validateIdentifier("0225", "303265045")).not.toThrow();
    expect(() => validateIdentifier("0225", "30326504500011")).not.toThrow();
  });

  it("accepts the routing forms of the annuaire", () => {
    expect(() => validateIdentifier("0225", "303265045_achattype1")).not.toThrow();
    expect(() =>
      validateIdentifier("0225", "303265045_30326504500011")
    ).not.toThrow();
    expect(() =>
      validateIdentifier("0225", "303265045_30326504500011_01")
    ).not.toThrow();
  });

  it("rejects an invalid check digit, in the address and in a SIRET it names", () => {
    expect(() => validateIdentifier("0225", "123456789")).toThrow(
      "invalid check digit"
    );
    expect(() => validateIdentifier("0225", "30326504500001")).toThrow(
      "invalid check digit"
    );
    expect(() =>
      validateIdentifier("0225", "303265045_30326504500001")
    ).toThrow("invalid check digit");
  });

  it("rejects anything that does not open with a company number", () => {
    expect(() => validateIdentifier("0225", "30326504")).toThrow();
    expect(() => validateIdentifier("0225", "fr303265045")).toThrow();
    expect(() => validateIdentifier("0225", "achattype1_303265045")).toThrow();
  });

  it("rejects a malformed suffix", () => {
    expect(() => validateIdentifier("0225", "303265045_")).toThrow();
    expect(() => validateIdentifier("0225", "303265045__01")).toThrow();
    expect(() => validateIdentifier("0225", "303265045_achat.type")).toThrow();
  });
});

describe("validateIdentifier for French SIREN (0002) and SIRET (0009)", () => {
  it("accepts a well formed SIREN and SIRET", () => {
    expect(() => validateIdentifier("0002", "303265045")).not.toThrow();
    expect(() => validateIdentifier("0009", "30326504500011")).not.toThrow();
  });

  it("rejects the one for the other", () => {
    expect(() => validateIdentifier("0002", "30326504500011")).toThrow();
    expect(() => validateIdentifier("0009", "303265045")).toThrow();
  });

  it("rejects an invalid check digit", () => {
    expect(() => validateIdentifier("0002", "123456789")).toThrow(
      "invalid check digit"
    );
  });
});

describe("validateCountryIdentifier for France", () => {
  it("accepts a SIREN as enterprise number", () => {
    expect(() =>
      validateCountryIdentifier("FR", { enterpriseNumber: "303265045" })
    ).not.toThrow();
  });

  it("rejects anything else as enterprise number, a SIRET included", () => {
    expect(() =>
      validateCountryIdentifier("FR", { enterpriseNumber: "30326504500011" })
    ).toThrow("exactly 9 digits");
    expect(() =>
      validateCountryIdentifier("FR", { enterpriseNumber: "123456789" })
    ).toThrow("invalid check digit");
  });

  it("accepts a VAT number with a matching key", () => {
    expect(() =>
      validateCountryIdentifier("FR", { vatNumber: "FR40303265045" })
    ).not.toThrow();
  });

  it("accepts the alphanumeric keys that cannot be computed", () => {
    expect(() =>
      validateCountryIdentifier("FR", { vatNumber: "FR4A303265045" })
    ).not.toThrow();
  });

  it("rejects a VAT number with a wrong numeric key", () => {
    expect(() =>
      validateCountryIdentifier("FR", { vatNumber: "FR41303265045" })
    ).toThrow("invalid key");
  });

  it("rejects a malformed VAT number", () => {
    expect(() =>
      validateCountryIdentifier("FR", { vatNumber: "FR303265045" })
    ).toThrow("2 character key");
    expect(() =>
      validateCountryIdentifier("FR", { vatNumber: "FRIO303265045" })
    ).toThrow("2 character key");
  });
});
