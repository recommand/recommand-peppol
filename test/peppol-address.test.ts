import { describe, it, expect } from "bun:test";
import { parsePeppolAddress } from "../utils/parsing/peppol-address";
import { validateIdentifier } from "../utils/identifier-validation";

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
