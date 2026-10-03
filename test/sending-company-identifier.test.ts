import { describe, expect, it, mock } from "bun:test";

// The choice under test never touches the database, but the module it lives in
// connects at import time.
mock.module("@recommand/db", () => ({ db: {} }));

const { chooseSendingCompanyIdentifier } = await import("../data/company-identifiers");

const siren = { scheme: "0225", identifier: "443061841" };
const siret = { scheme: "0225", identifier: "44306184100047" };
const suffixed = { scheme: "0225", identifier: "443061841_0001" };
const sirenScheme = { scheme: "0002", identifier: "443061841" };
const siretScheme = { scheme: "0009", identifier: "44306184100047" };
const belgian = { scheme: "0208", identifier: "1012081766" };

const frenchCompany = { accessPointProvider: "at-shared-ap-fr" } as const;
const otherCompany = { accessPointProvider: "recommand-ap1" } as const;

// In the order getCompanyIdentifiers lists them: by scheme, then by identifier.
function sorted<T extends { scheme: string; identifier: string }>(...identifiers: T[]): T[] {
  return [...identifiers].sort(
    (a, b) => a.scheme.localeCompare(b.scheme) || a.identifier.localeCompare(b.identifier)
  );
}

describe("the address a company sends under", () => {
  it("is the SIREN under the French electronic address scheme through the French access point, even when lower schemes exist", () => {
    expect(
      chooseSendingCompanyIdentifier(frenchCompany, sorted(sirenScheme, siretScheme, siret, siren))
    ).toBe(siren);
  });

  it("is refused through the French access point when the company has no such identifier", () => {
    for (const identifiers of [
      sorted(sirenScheme, siretScheme),
      sorted(siret),
      sorted(suffixed),
      sorted(sirenScheme, siret, suffixed),
    ]) {
      expect(() => chooseSendingCompanyIdentifier(frenchCompany, identifiers)).toThrow(
        /scheme 0225 and the company's 9 digit SIREN/
      );
    }
  });

  it("stays the lowest scheme for every other access point", () => {
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(belgian, siren, sirenScheme))).toBe(
      sirenScheme
    );
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(belgian))).toBe(belgian);
  });

  it("refuses a company without identifiers the same way for every access point", () => {
    for (const company of [frenchCompany, otherCompany]) {
      expect(() => chooseSendingCompanyIdentifier(company, [])).toThrow(
        /No sending company identifier found/
      );
    }
  });

  it("passes over a Leitweg-ID, which only names an authority's invoice reception", () => {
    const leitwegId = { scheme: "0204", identifier: "991-33333test-33" };
    const vat = { scheme: "9930", identifier: "de136695976" };
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(vat, leitwegId))).toBe(vat);
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(leitwegId))).toBe(leitwegId);
  });

  it("goes out under the VAT number, else the GLN, to a Leitweg-ID", () => {
    const vat = { scheme: "9930", identifier: "de136695976" };
    const gln = { scheme: "0088", identifier: "4000001000005" };
    const iban = { scheme: "9918", identifier: "de89370400440532013000" };
    const toAuthority = "0204:991-33333test-33";
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(iban, gln, vat), toAuthority)).toBe(vat);
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(iban, gln), toAuthority)).toBe(gln);
    // Other recipients keep the lowest scheme.
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(iban, gln, vat), "9930:de811569869")).toBe(gln);
  });

  it("sends a foreign supplier's document to a Leitweg-ID as it would any other", () => {
    expect(chooseSendingCompanyIdentifier(otherCompany, sorted(belgian), "0204:991-33333test-33")).toBe(belgian);
  });

  it("keeps the SIREN through the French access point, whatever the recipient", () => {
    expect(chooseSendingCompanyIdentifier(frenchCompany, sorted(sirenScheme, siren), "0204:991-33333test-33")).toBe(siren);
  });
});
