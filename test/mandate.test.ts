import { describe, expect, it } from "bun:test";
import {
  getMandateDocument,
  resolveCompanyKycIdentity,
  type CompanyKycIdentity,
  type MandateInput,
} from "../data/at/mandate";
import { buildMandateTemplateData } from "../data/at/mandates/default";
import { buildFrenchMandateTemplateData } from "../data/at/mandates/france";
import { MANDATE_TEMPLATE } from "../templates/mandate";
import { FRENCH_MANDATE_TEMPLATE } from "../templates/mandate-fr";
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
  accessPointProvider: "at-shared-ap-fr",
  smpProvider: "at-shared-smp-fr",
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

const frenchMandateInput = {
  reference: "cvl_1",
  company: frenchCompany,
  identifiers,
  identity: frenchIdentity,
  signatory: { firstName: "Jeanne", lastName: "Durand", role: "Gérante" },
  signedAt: new Date("2026-07-28T09:30:00Z"),
  proofReference: "didit_session_1",
} as MandateInput;

const belgianMandateInput = {
  ...frenchMandateInput,
  company: belgianCompany,
  identifiers: [
    { scheme: "0208", identifier: "0700123456" },
  ] as CompanyIdentifier[],
  identity: resolveCompanyKycIdentity(belgianCompany, []),
} as MandateInput;

/** Every placeholder a template renders has to be filled by its data. */
function assertTemplateIsFilled(template: string, data: unknown) {
  const placeholders = new Set(
    [...template.matchAll(/\{\{[#^/]?([\w.]+)\}\}/g)].map((match) => match[1])
  );

  const available = new Set<string>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        available.add(key);
        collect(nested);
      }
    }
  };
  collect(data);

  for (const placeholder of placeholders) {
    expect(available).toContain(placeholder);
  }
}

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

describe("Mandate document selection", () => {
  it("gives France its own document and everyone else the default one", () => {
    expect(getMandateDocument("FR").template).toBe(FRENCH_MANDATE_TEMPLATE);
    expect(getMandateDocument("BE").template).toBe(MANDATE_TEMPLATE);
    expect(getMandateDocument(null).template).toBe(MANDATE_TEMPLATE);
  });

  it("names each document the way its own PDF is titled", () => {
    // The signing UI shows this verbatim, so it has to match the rendered PDF.
    expect(getMandateDocument("FR").title).toBe(
      "Mandat de désignation de plateforme agréée"
    );
    expect(buildFrenchMandateTemplateData(frenchMandateInput).title).toBe(
      getMandateDocument("FR").title
    );
    expect(getMandateDocument("BE").title).toBe("Mandate for electronic invoicing");
    expect(buildMandateTemplateData(belgianMandateInput).title).toBe(
      getMandateDocument("BE").title
    );
  });

  it("states the signatory's function in the language of the document", () => {
    expect(getMandateDocument("FR").defaultSignatoryRole).toBe("Représentant légal");
    expect(getMandateDocument("BE").defaultSignatoryRole).toBe("Legal representative");
  });
});

describe("Default mandate document", () => {
  it("states the company, the platform and the signature", () => {
    const data = buildMandateTemplateData(belgianMandateInput);

    expect(data).toMatchObject({
      reference: "cvl_1",
      effectiveDate: "2026-07-28",
      durationLabel: "an indefinite term",
    });
    expect(data.company).toEqual({
      legalName: "ACME BV",
      street: "Grote Markt 1",
      postalCode: "2000",
      city: "Antwerpen",
      countryName: "Belgium",
      rows: [
        { label: "Company number (0208)", value: "0700123456" },
        { label: "VAT number", value: "BE0700123456" },
      ],
    });
    expect(data.electronicAddresses).toEqual([{ value: "0208:0700123456" }]);
    expect(data.signatory).toMatchObject({
      fullName: "Jeanne Durand",
      role: "Gérante",
      proofReference: "didit_session_1",
    });
    expect(data.signatory.signedAt).toBe("2026-07-28 11:30");
  });

  it("carries no French regime wording at all", () => {
    const data = buildMandateTemplateData(belgianMandateInput);

    expect(data.platform.description).toBe(
      "Arratech, Peppol access point and service metadata publisher. Mandate concluded through Recommand, e-invoicing operator."
    );
    expect(data.scopeItems.map((item) => item.title)).toEqual([
      "Receiving electronic invoices",
      "Sending electronic invoices",
      "Directory registration",
    ]);
    expect(JSON.stringify(data)).not.toContain("CDAR");
    expect(JSON.stringify(data)).not.toContain("e-reporting");
  });

  it("leaves out reception for a company that only sends", () => {
    const data = buildMandateTemplateData({
      ...belgianMandateInput,
      company: { ...belgianCompany, isSmpRecipient: false },
    });

    expect(data.scopeItems.map((item) => item.title)).not.toContain(
      "Receiving electronic invoices"
    );
  });

  it("names the signatory but carries no proof while unsigned", () => {
    // The draft the representative reads before Didit has no signature proof yet.
    const data = buildMandateTemplateData({
      ...belgianMandateInput,
      proofReference: null,
    });

    expect(data.signatory).toMatchObject({
      fullName: "Jeanne Durand",
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
    assertTemplateIsFilled(MANDATE_TEMPLATE, buildMandateTemplateData(belgianMandateInput));
  });
});

describe("French mandate document", () => {
  const frenchAddresses = [
    { scheme: "0225", identifier: "303265045" },
    { scheme: "0225", identifier: "303265045_ACHATTYPE1" },
    { scheme: "0009", identifier: "30326504500011" },
    { scheme: "0225", identifier: "303265045_30326504500011_01" },
  ] as CompanyIdentifier[];

  it("is written in French and follows the FNFE model", () => {
    expect(FRENCH_MANDATE_TEMPLATE).toContain('lang="fr"');
    // The seven numbered blocks of the model, by their own wording.
    for (const block of [
      "Assujetti donnant mandat à une Plateforme Agréée",
      "Plateforme Agréée (PA) désignée par l'Assujetti",
      "Date à partir de laquelle l'Assujetti",
      "Périmètre des adresses de facturation électroniques de réception",
      "Ancienne PA en charge de tout ou partie des adresses",
      "Numéro de mandat",
      "Signature du représentant légal de l'Assujetti",
    ]) {
      expect(FRENCH_MANDATE_TEMPLATE).toContain(block);
    }
  });

  it("names Arratech AB by its PA matricule, since it has no SIREN", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.platform).toEqual({
      legalName: "Arratech AB",
      siren: null,
      matricule: "0153",
    });
  });

  it("names the assujetti by its SIREN and postal address", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.assujetti).toEqual({
      legalName: "ACME SARL",
      siren: "303265045",
      street: "12 rue de la Paix",
      postalCode: "75002",
      city: "Paris",
      countryName: "France",
    });
    // The assumed head office SIRET has no place on the mandate.
    expect(JSON.stringify(data)).not.toContain("30326504500001");
  });

  it("takes effect on the date it is drawn up, written as the model writes it", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.effectiveDate).toBe("28/07/2026");
    expect(data.signatory.signedAt).toBe("28/07/2026 à 11:30");
  });

  it("files every address under the block 4 category of its form", () => {
    const data = buildFrenchMandateTemplateData({
      ...frenchMandateInput,
      identifiers: frenchAddresses,
    });

    expect(
      data.addressCategories.map((category) => [
        category.isChecked,
        category.addresses.map((address) => address.value),
      ])
    ).toEqual([
      [true, ["303265045"]],
      [true, ["303265045_ACHATTYPE1"]],
      [true, ["303265045_30326504500011"]],
      [true, ["303265045_30326504500011_01"]],
    ]);
  });

  it("leaves the categories it does not register unchecked", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.addressCategories.map((category) => category.isChecked)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("writes addresses in their annuaire form, without the Peppol scheme", () => {
    const data = buildFrenchMandateTemplateData({
      ...frenchMandateInput,
      identifiers: [{ scheme: "0009", identifier: "30326504500011" }] as CompanyIdentifier[],
    });

    // A SIRET registered on its own is written SIREN_SIRET in the annuaire.
    expect(data.mandateNumbers[0].address).toBe("303265045_30326504500011");
    expect(JSON.stringify(data)).not.toContain("0009:");
  });

  it("numbers the mandate as SIREN_matricule_AAAAMMJJ_compteur", () => {
    const data = buildFrenchMandateTemplateData({
      ...frenchMandateInput,
      identifiers: frenchAddresses,
    });

    expect(data.mandateNumbers.map((number) => number.value)).toEqual([
      "303265045_0153_20260728_01",
      "303265045_0153_20260728_02",
      "303265045_0153_20260728_03",
      "303265045_0153_20260728_04",
    ]);
  });

  it("carries block 5 even when no previous PA is declared", () => {
    expect(buildFrenchMandateTemplateData(frenchMandateInput).previousPlatform).toBeNull();
    expect(FRENCH_MANDATE_TEMPLATE).toContain("{{^previousPlatform}}");
  });

  it("splits the signatory into the prénom, nom and fonction the model asks for", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.signatory).toMatchObject({
      firstName: "Jeanne",
      lastName: "Durand",
      role: "Gérante",
      proofReference: "didit_session_1",
    });
  });

  it("keeps sending and e-reporting in an annex, out of blocks 1 to 7", () => {
    const data = buildFrenchMandateTemplateData(frenchMandateInput);

    expect(data.annex?.items.map((item) => item.title)).toEqual([
      "Émission de factures électroniques",
      "Transmission des données de e-reporting",
    ]);
    // Block 4 lists addresses only; nothing else may creep into it.
    expect(JSON.stringify(data.addressCategories)).not.toContain("e-reporting");
  });

  it("drops the sending delegation for a company that only receives", () => {
    const data = buildFrenchMandateTemplateData({
      ...frenchMandateInput,
      company: { ...frenchCompany, accessPointProvider: "recommand-ap1" } as Company,
    });

    expect(data.annex?.items.map((item) => item.title)).toEqual([
      "Transmission des données de e-reporting",
    ]);
  });

  it("refuses an address that does not belong to the mandating SIREN", () => {
    expect(() =>
      buildFrenchMandateTemplateData({
        ...frenchMandateInput,
        identifiers: [{ scheme: "0225", identifier: "133512194" }] as CompanyIdentifier[],
      })
    ).toThrow(/does not belong to SIREN 303265045/);
  });

  it("refuses to draw up a mandate with no French address to register", () => {
    expect(() =>
      buildFrenchMandateTemplateData({
        ...frenchMandateInput,
        identifiers: [{ scheme: "0208", identifier: "0700123456" }] as CompanyIdentifier[],
      })
    ).toThrow(/no French electronic address/);
  });

  it("fills every placeholder the template renders", () => {
    assertTemplateIsFilled(
      FRENCH_MANDATE_TEMPLATE,
      buildFrenchMandateTemplateData({
        ...frenchMandateInput,
        identifiers: frenchAddresses,
      })
    );
  });
});
