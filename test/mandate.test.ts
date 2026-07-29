import { describe, expect, it } from "bun:test";
import {
  buildMandateTemplateData,
  resolveCompanyKycIdentity,
  type CompanyKycIdentity,
} from "../data/at/mandate";
import { MANDATE_TEMPLATE } from "../templates/mandate";
import type { Company } from "../data/companies";
import type { CompanyIdentifier } from "../data/company-identifiers";

const frenchCompany = {
  id: "c_1",
  name: "ACME SARL",
  address: "12 rue de la Paix",
  postalCode: "75002",
  city: "Paris",
  country: "FR",
  enterpriseNumber: "303265045",
  enterpriseNumberScheme: "0225",
  vatNumber: "FR12303265045",
  isSmpRecipient: true,
  accessPointProvider: "at-shared-ap",
  smpProvider: "at-shared-smp",
} as unknown as Company;

const belgianCompany = {
  ...frenchCompany,
  name: "ACME BV",
  address: "Grote Markt 1",
  postalCode: "2000",
  city: "Antwerpen",
  country: "BE",
  enterpriseNumber: "0700123456",
  enterpriseNumberScheme: "0208",
  vatNumber: "BE0700123456",
} as unknown as Company;

const identifiers = [
  { scheme: "0225", identifier: "303265045" },
] as CompanyIdentifier[];

const frenchIdentity: CompanyKycIdentity = {
  rows: [
    { label: "SIREN", value: "303265045" },
    { label: "VAT number", value: "FR12303265045" },
  ],
  metaData: { siren: "303265045", siret: "30326504500001" },
  notes: ["SIRET 30326504500001 assumed to be the head office"],
};

const mandateInput = {
  reference: "cvl_1",
  company: frenchCompany,
  identifiers,
  identity: frenchIdentity,
  signatory: { firstName: "Jeanne", lastName: "Durand", role: "Gérante" },
  signedAt: new Date("2026-07-28T09:30:00Z"),
  proofReference: "didit_session_1",
};

// 303265045 and 30326504500011 carry a valid Luhn key, 303265046 does not.
function resolveFrench(
  enterpriseNumber: string | null,
  identifiers: { scheme: string; identifier: string }[] = []
) {
  return resolveCompanyKycIdentity(
    {
      country: "FR",
      enterpriseNumber,
      enterpriseNumberScheme: "0225",
      vatNumber: null,
    },
    identifiers as CompanyIdentifier[]
  );
}

describe("French company identity", () => {
  it("assumes the head office SIRET when only a SIREN is known", () => {
    const identity = resolveFrench("303265045");

    expect(identity.metaData).toEqual({
      siren: "303265045",
      siret: "30326504500001",
    });
    expect(identity.notes).toEqual([
      "SIRET 30326504500001 assumed to be the head office, the company only gave us its SIREN",
    ]);
  });

  it("names the company by its SIREN, and by its SIRET only when known", () => {
    expect(resolveFrench("303265045").rows).toEqual([
      { label: "SIREN", value: "303265045" },
    ]);
    expect(resolveFrench("30326504500011").rows).toEqual([
      { label: "SIREN", value: "303265045" },
      { label: "SIRET", value: "30326504500011" },
    ]);
  });

  it("keeps a SIRET that is stored as the enterprise number", () => {
    const identity = resolveFrench("30326504500011");

    expect(identity.metaData).toEqual({
      siren: "303265045",
      siret: "30326504500011",
    });
    expect(identity.notes).toEqual([]);
  });

  it("reads separators and the routing suffix of an electronic address", () => {
    expect(
      resolveFrench("303 265 045", [
        { scheme: "0208", identifier: "0700123456" },
        { scheme: "0225", identifier: "303265045_STATUTS" },
      ]).metaData
    ).toMatchObject({ siren: "303265045" });
  });

  it("takes the SIRET from a SIRET identifier over assuming one", () => {
    const identity = resolveFrench("303265045", [
      { scheme: "0009", identifier: "30326504500011" },
    ]);

    expect(identity.metaData?.siret).toBe("30326504500011");
    expect(identity.notes).toEqual([]);
  });

  it("refuses a number that fails its check digit", () => {
    expect(() => resolveFrench("303265046")).toThrow(/not a valid SIREN or SIRET/);
  });

  it("refuses a foreign number that happens to be nine digits", () => {
    // A Belgian enterprise number without its leading zero must not pass as a SIREN.
    expect(() => resolveFrench("700123456")).toThrow(/not a valid SIREN or SIRET/);
  });

  it("refuses numbers that name different companies", () => {
    expect(() =>
      resolveFrench("303265045", [{ scheme: "0225", identifier: "133512194" }])
    ).toThrow(/name different companies/);
  });

  it("refuses to pick between establishments", () => {
    expect(() =>
      resolveFrench(null, [
        { scheme: "0225", identifier: "30326504500011" },
        { scheme: "0225", identifier: "30326504500029" },
      ])
    ).toThrow(/several establishments/);
  });

  it("has nothing to file when the company gave no number", () => {
    expect(() =>
      resolveFrench(null, [{ scheme: "0208", identifier: "0700123456" }])
    ).toThrow(/no SIREN or SIRET/);
  });
});

describe("Company identity outside France", () => {
  it("names the company by the numbers it registered, as is", () => {
    expect(resolveCompanyKycIdentity(belgianCompany, [])).toEqual({
      rows: [
        { label: "Company number (0208)", value: "0700123456" },
        { label: "VAT number", value: "BE0700123456" },
      ],
      // Arratech has only defined KYC metadata for France, so there is none to send.
      notes: [],
    });
  });

  it("does not hold a foreign number to the French format", () => {
    // Nothing outside France has a number format we know how to check.
    expect(
      resolveCompanyKycIdentity(
        { ...belgianCompany, enterpriseNumber: "not-a-number" },
        []
      ).rows
    ).toContainEqual({ label: "Company number (0208)", value: "not-a-number" });
  });

  it("files a company that registered no number at all", () => {
    expect(
      resolveCompanyKycIdentity(
        { ...belgianCompany, enterpriseNumber: null, vatNumber: null },
        []
      ).rows
    ).toEqual([]);
  });
});

describe("Mandate document", () => {
  it("states the company, the platform and the signature", () => {
    const data = buildMandateTemplateData(mandateInput);

    expect(data).toMatchObject({
      reference: "cvl_1",
      effectiveDate: "2026-07-28",
      durationLabel: "an indefinite term",
    });
    expect(data.company).toEqual({
      legalName: "ACME SARL",
      street: "12 rue de la Paix",
      postalCode: "75002",
      city: "Paris",
      countryName: "France",
      rows: frenchIdentity.rows,
    });
    expect(data.electronicAddresses).toEqual([{ value: "0225:303265045" }]);
    expect(data.signatory).toMatchObject({
      fullName: "Jeanne Durand",
      role: "Gérante",
      proofReference: "didit_session_1",
    });
    expect(data.signatory.signedAt).toBe("2026-07-28 11:30");
  });

  it("presents Arratech as the French PA for a French company", () => {
    const data = buildMandateTemplateData(mandateInput);

    expect(data.frenchTitle).toBe(
      "Mandat de facturation électronique et de e-reporting"
    );
    expect(data.platform.description).toBe(
      "Plateforme agréée (PA) Arratech, immatriculation 3309. Mandate concluded through Recommand, e-invoicing operator."
    );
  });

  it("drops the French regime wording for a company elsewhere", () => {
    const data = buildMandateTemplateData({
      ...mandateInput,
      company: belgianCompany,
      identity: resolveCompanyKycIdentity(belgianCompany, []),
    });

    expect(data.frenchTitle).toBeNull();
    expect(data.platform.description).toBe(
      "Arratech, Peppol access point and service metadata publisher. Mandate concluded through Recommand, e-invoicing operator."
    );
    expect(data.scopeItems.map((item) => item.title)).toEqual([
      "Receiving electronic invoices",
      "Sending electronic invoices",
      "Directory registration",
    ]);
    expect(JSON.stringify(data.scopeItems)).not.toContain("CDAR");
  });

  it("delegates reception, sending, e-reporting and the directory in France", () => {
    const data = buildMandateTemplateData(mandateInput);

    expect(data.scopeItems.map((item) => item.title)).toEqual([
      "Receiving electronic invoices",
      "Sending electronic invoices",
      "Transmitting e-reporting data",
      "Directory registration",
    ]);
  });

  it("leaves out reception for a company that only sends", () => {
    const data = buildMandateTemplateData({
      ...mandateInput,
      company: { ...frenchCompany, isSmpRecipient: false },
    });

    expect(data.scopeItems.map((item) => item.title)).not.toContain(
      "Receiving electronic invoices"
    );
  });

  it("names the signatory but carries no proof while unsigned", () => {
    // The draft the representative reads before Didit has no signature proof yet.
    const data = buildMandateTemplateData({ ...mandateInput, proofReference: null });

    expect(data.signatory).toMatchObject({
      fullName: "Jeanne Durand",
      role: "Gérante",
      proofReference: null,
    });
  });

  it("keeps the electronic signature block out of the unsigned draft", () => {
    const signedOnly = MANDATE_TEMPLATE.slice(
      MANDATE_TEMPLATE.indexOf("{{#proofReference}}"),
      MANDATE_TEMPLATE.indexOf("{{/proofReference}}")
    );

    // Rendering the block only inside the section is what drops it from the draft.
    expect(signedOnly).toContain("Electronic signature");
    expect(MANDATE_TEMPLATE.split("Electronic signature")).toHaveLength(2);
  });

  it("fills every placeholder the template renders", () => {
    const data = buildMandateTemplateData(mandateInput);
    const placeholders = new Set(
      [...MANDATE_TEMPLATE.matchAll(/\{\{[#^/]?([\w.]+)\}\}/g)].map(
        (match) => match[1]
      )
    );
    const available = new Set([
      ...Object.keys(data),
      ...Object.keys(data.company),
      ...Object.keys(data.company.rows[0]),
      ...Object.keys(data.platform),
      ...Object.keys(data.scopeItems[0]),
      ...Object.keys(data.electronicAddresses[0]),
      ...Object.keys(data.signatory),
    ]);

    for (const placeholder of placeholders) {
      expect(available).toContain(placeholder);
    }
  });
});
