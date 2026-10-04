import { describe, expect, it, mock } from "bun:test";
import { COUNTRIES } from "../utils/countries";
import { countryIdentifierRules } from "../utils/identifiers/countries";
import {
  getVatNumberPrefixes,
  normalizeIdentifierValue,
  validateCompanyNumbers,
  validateCountryIdentifier,
  validateIdentifier,
  validateIdentifierBelongsToCompany,
} from "../utils/identifier-validation";

// Every country's VAT number and enterprise number, held to the national format and,
// where the country published it, the national check. A country's default Peppol
// schemes take the same rules, and an identifier under one of them has to be the
// company's own number.
//
// The valid samples are real numbers their holders publish (on their own website,
// imprint or invoicing page, or in their national register), unless marked otherwise.

type NumberCase = {
  /** Two different valid numbers, so one can stand in for another company's. */
  valid: [string, string, ...string[]];
  /** A valid number with its check digit changed; absent where no check is published. */
  badCheck?: string;
  /** A number of the wrong length or shape. */
  badFormat: string;
};

type CountryCase = {
  country: string;
  vatNumber?: NumberCase;
  enterpriseNumber?: NumberCase;
};

const cases: CountryCase[] = [
  {
    country: "AT",
    // Bundesministerium für Finanzen, OMV AG
    vatNumber: { valid: ["ATU37866403", "ATU14189108"], badCheck: "ATU37866404", badFormat: "ATU3786640" },
    // OMV AG's Firmenbuchnummer, ams-OSRAM AG's register key (Statistik Austria)
    enterpriseNumber: { valid: ["FN 93363z", "R012W1121", "93363z"], badFormat: "93363" },
  },
  {
    country: "AU",
    // Australian Taxation Office, BHP Group Limited
    enterpriseNumber: { valid: ["51824753556", "49004028077", "51 824 753 556"], badCheck: "51824753557", badFormat: "5182475355" },
  },
  {
    country: "BE",
    // Proximus; the second is a well formed example
    vatNumber: { valid: ["BE0202239951", "BE0123456749"], badCheck: "BE0202239952", badFormat: "BE020223995" },
    enterpriseNumber: { valid: ["0202239951", "0123456749"], badCheck: "0202239952", badFormat: "020223995" },
  },
  {
    country: "BG",
    // Vivacom, Ministry of Finance
    vatNumber: { valid: ["BG831642181", "BG000695406"], badFormat: "BG83164218" },
  },
  {
    country: "CY",
    // Indication Investments Ltd, Electricity Authority of Cyprus
    vatNumber: { valid: ["CY10290930F", "CY90000020C"], badFormat: "CY102909301" },
  },
  {
    country: "DE",
    vatNumber: { valid: ["DE136695976", "DE811569869"], badCheck: "DE136695977", badFormat: "DE13669597" },
  },
  {
    country: "DK",
    // Erhvervsstyrelsen, Novo Nordisk
    vatNumber: { valid: ["DK10150817", "DK24256790"], badCheck: "DK10150818", badFormat: "DK1015081" },
    enterpriseNumber: { valid: ["10150817", "24256790", "DK10150817"], badCheck: "10150818", badFormat: "1015081" },
  },
  {
    country: "EE",
    // Telia Eesti AS, Elisa Eesti AS; AS Tallink Grupp, the Centre of Registers and Information Systems
    vatNumber: { valid: ["EE100070008", "EE100130171"], badCheck: "EE100070009", badFormat: "EE10007000" },
    enterpriseNumber: { valid: ["10238429", "70000310"], badCheck: "10238428", badFormat: "20238429" },
  },
  {
    country: "ES",
    // Telefónica, Agencia Tributaria, FC Barcelona; a DNI and an NIE are well formed examples
    vatNumber: {
      valid: ["ESA28015865", "ESQ2826000H", "ESG08266298", "ES12345678Z", "ESX1234567L"],
      badCheck: "ES12345678A",
      badFormat: "ESA2801586",
    },
  },
  {
    country: "FI",
    // Verohallinto, Nokia
    vatNumber: { valid: ["FI02454583", "FI01120389"], badCheck: "FI02454584", badFormat: "FI0245458" },
  },
  {
    country: "FR",
    vatNumber: { valid: ["FR40303265045", "FR4A303265045"], badCheck: "FR41303265045", badFormat: "FR303265045" },
    enterpriseNumber: { valid: ["303265045", "784301772"], badCheck: "303265046", badFormat: "30326504" },
  },
  {
    country: "GB",
    // Sainsbury's, Octopus Energy (a 9755 series number), Tesco in Northern Ireland
    vatNumber: {
      valid: ["GB660454836", "GB358672751", "XI220430231", "GB660454836001", "GBGD001"],
      badCheck: "GB660454837",
      badFormat: "GB66045483",
    },
  },
  {
    country: "GR",
    // National Bank of Greece, OTE
    vatNumber: { valid: ["EL094014201", "EL094019245", "GR094014201"], badFormat: "EL09401420" },
  },
  {
    country: "HR",
    // Ministarstvo financija, Hrvatski Telekom
    vatNumber: { valid: ["HR18683136487", "HR81793146560"], badCheck: "HR18683136488", badFormat: "HR1868313648" },
  },
  {
    country: "HU",
    // Magyar Telekom, 4iG
    vatNumber: { valid: ["HU10773381", "HU12011069"], badCheck: "HU10773382", badFormat: "HU1077338" },
  },
  {
    country: "IE",
    // Google Ireland, University of Limerick, Stripe (9 characters), BAM Civil (older form)
    vatNumber: {
      valid: ["IE6388047V", "IE6609370G", "IE3396855EH", "IE8D79739I"],
      badCheck: "IE6388047W",
      badFormat: "IE638804V",
    },
  },
  {
    country: "IS",
    // Þjóðskrá, two companies registered in September 2026
    enterpriseNumber: { valid: ["6503760649", "4709261550", "650376-0649"], badCheck: "6503760659", badFormat: "650376064" },
  },
  {
    country: "IT",
    // Eni, TIM; Eni's and the Ministry of Economy and Finance's codici fiscali, and a
    // well formed personal one
    vatNumber: { valid: ["IT00905811006", "IT00488410010"], badCheck: "IT00905811007", badFormat: "IT0090581100" },
    enterpriseNumber: { valid: ["00484960588", "80415740580", "RSSMRA85T10A562S"], badCheck: "00484960589", badFormat: "0048496058" },
  },
  {
    country: "LU",
    vatNumber: { valid: ["LU15027442", "LU20260743"], badCheck: "LU15027443", badFormat: "LU1502744" },
  },
  {
    country: "LV",
    // Latvenergo, Valsts ieņēmumu dienests
    vatNumber: { valid: ["LV40003032949", "LV90000069281"], badFormat: "LV4000303294" },
    enterpriseNumber: { valid: ["40003032949", "90000069281"], badFormat: "10003032949" },
  },
  {
    country: "NL",
    // Well formed examples; the KVK numbers of the Kamer van Koophandel and Philips
    vatNumber: { valid: ["NL123456789B01", "NL987654321B02"], badFormat: "NL123456789" },
    enterpriseNumber: { valid: ["59581883", "17001910"], badFormat: "5958188" },
  },
  {
    country: "NO",
    // Brønnøysundregistrene, Equinor
    enterpriseNumber: { valid: ["974760673", "923609016"], badCheck: "974760674", badFormat: "97476067" },
  },
  {
    country: "PL",
    // Ministerstwo Finansów, PKO BP
    vatNumber: { valid: ["PL5260250274", "PL5250007738", "PL 526-025-02-74"], badCheck: "PL5260250275", badFormat: "PL526025027" },
  },
  {
    country: "PT",
    // EDP, Autoridade Tributária
    vatNumber: { valid: ["PT500697256", "PT600084779"], badFormat: "PT050069725" },
  },
  {
    country: "RO",
    // Romgaz, BRD
    vatNumber: { valid: ["RO14056826", "RO361579"], badCheck: "RO14056827", badFormat: "RO01405682" },
  },
  {
    country: "SE",
    // Skatteverket, the Peppol code list's example
    enterpriseNumber: { valid: ["2021005448", "2120000787", "202100-5448"], badCheck: "2021005449", badFormat: "202100544" },
  },
  {
    country: "SI",
    // Ministry of Finance, Zavarovalnica Triglav
    vatNumber: { valid: ["SI23348887", "SI80040306"], badCheck: "SI23348888", badFormat: "SI2334888" },
  },
  {
    country: "SK",
    // Slovak Telekom, ESET; the DIČ of Slovak Telekom and SLOVNAFT
    vatNumber: { valid: ["SK2020273893", "SK2020317068"], badCheck: "SK2020273894", badFormat: "SK202027389" },
    enterpriseNumber: { valid: ["2020273893", "2020372640"], badCheck: "2020372641", badFormat: "35763469" },
  },
];

const countryInfo = (code: string) => COUNTRIES.find((country) => country.code === code)!;
const schemeFor = (code: string, kind: "vatNumber" | "enterpriseNumber") =>
  kind === "vatNumber" ? countryInfo(code).defaultVatScheme : countryInfo(code).defaultEnterpriseNumberScheme;

describe("national identifier rules", () => {
  it("cover the VAT and enterprise number scheme of every country", () => {
    for (const country of COUNTRIES) {
      for (const scheme of [country.defaultVatScheme, country.defaultEnterpriseNumberScheme]) {
        if (scheme) {
          expect(() => validateIdentifier(scheme, "not-a-number"), `${country.code} ${scheme}`).toThrow();
        }
      }
    }
  });

  it("are registered for countries countries.ts knows, once each", () => {
    const codes = countryIdentifierRules.map((rules) => rules.country);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(COUNTRIES.some((country) => country.code === code), code).toBe(true);
    }
  });

  it("are tested for every country with a scheme", () => {
    const tested = new Set(cases.map((entry) => entry.country));
    for (const country of COUNTRIES) {
      if (country.defaultVatScheme || country.defaultEnterpriseNumberScheme) {
        expect(tested.has(country.code), country.code).toBe(true);
      }
    }
  });
});

for (const { country, ...numbers } of cases) {
  for (const kind of ["vatNumber", "enterpriseNumber"] as const) {
    const numberCase = numbers[kind];
    if (!numberCase) {
      continue;
    }
    const scheme = schemeFor(country, kind);
    // France's enterprise number scheme is its electronic address, tested in peppol-address.test.ts.
    const schemeTakesTheNumber = scheme && !(country === "FR" && kind === "enterpriseNumber");
    const label = kind === "vatNumber" ? "VAT number" : "enterprise number";

    describe(`${country} ${label}${schemeTakesTheNumber ? ` (scheme ${scheme})` : ""}`, () => {
      it("accepts valid numbers, however they are written", () => {
        for (const value of numberCase.valid) {
          expect(() => validateCountryIdentifier(country, { [kind]: value }), value).not.toThrow();
          if (schemeTakesTheNumber) {
            expect(() => validateIdentifier(scheme, value), value).not.toThrow();
            expect(() => validateIdentifier(scheme, value.toLowerCase()), value).not.toThrow();
          }
        }
      });

      if (numberCase.badCheck) {
        it("refuses a wrong check digit", () => {
          expect(() => validateCountryIdentifier(country, { [kind]: numberCase.badCheck })).toThrow(/invalid (check digit|key)/);
          if (schemeTakesTheNumber) {
            expect(() => validateIdentifier(scheme, numberCase.badCheck!)).toThrow(/invalid (check digit|key)/);
          }
        });
      }

      it("refuses the wrong length or shape", () => {
        expect(() => validateCountryIdentifier(country, { [kind]: numberCase.badFormat })).toThrow(/ must /);
        if (schemeTakesTheNumber) {
          expect(() => validateIdentifier(scheme, numberCase.badFormat)).toThrow();
        }
      });

      if (kind === "vatNumber") {
        it("refuses another country's VAT number", () => {
          const other = country === "BE" ? "NL123456789B01" : "BE0202239951";
          expect(() => validateCountryIdentifier(country, { vatNumber: other })).toThrow(/VAT number must start with/);
          if (schemeTakesTheNumber) {
            expect(() => validateIdentifier(scheme, other)).toThrow(/VAT number must start with/);
          }
        });
      }

      if (schemeTakesTheNumber) {
        it("only takes the company's own number under its scheme", () => {
          const [own, someoneElses] = numberCase.valid;
          const company = { vatNumber: null, enterpriseNumber: null, [kind]: own };
          expect(() => validateIdentifierBelongsToCompany({ scheme, identifier: own, company })).not.toThrow();
          expect(() => validateIdentifierBelongsToCompany({ scheme, identifier: someoneElses, company })).toThrow(
            `must match the company ${label}`
          );
          expect(() =>
            validateIdentifierBelongsToCompany({ scheme, identifier: own, company: { vatNumber: null, enterpriseNumber: null } })
          ).toThrow(`requires a company ${label}`);
        });
      }
    });
  }
}

describe("a VAT number of another country under that country's scheme", () => {
  const belgian = { vatNumber: "BE0202239951", enterpriseNumber: "0202239951" };

  it("is refused, because the company can only prove its own", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9944", identifier: "NL123456789B01", company: belgian })
    ).toThrow("Scheme 9944 is for VAT numbers from the Netherlands, and a company can only register its own");
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9930", identifier: "DE136695976", company: belgian })
    ).toThrow("must match the company VAT number");
  });

  it("is refused for French VAT numbers as well, which are no country's default scheme", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9957", identifier: "FR40303265045", company: belgian })
    ).toThrow("must match the company VAT number");
    expect(() =>
      validateIdentifierBelongsToCompany({
        scheme: "9957",
        identifier: "FR40303265045",
        company: { vatNumber: "FR40303265045", enterpriseNumber: "303265045" },
      })
    ).not.toThrow();
  });

  it("leaves schemes that name no national number to their format", () => {
    for (const [scheme, identifier] of [["0088", "4000001000005"], ["9918", "DE89370400440532013000"]]) {
      expect(() => validateIdentifierBelongsToCompany({ scheme: scheme!, identifier: identifier!, company: belgian })).not.toThrow();
    }
  });
});

describe("VAT number prefixes", () => {
  it("are the country code, plus EL for Greece and XI for the United Kingdom", () => {
    expect(getVatNumberPrefixes("BE")).toEqual(["BE"]);
    expect(getVatNumberPrefixes("GR")).toEqual(["EL", "GR"]);
    expect(getVatNumberPrefixes("GB")).toEqual(["GB", "XI"]);
  });
});

describe("VAT schemes that are no country's default", () => {
  const belgian = { vatNumber: "BE0202239951", enterpriseNumber: "0202239951" };

  it("hold the number to its country's rules where we have them", () => {
    expect(() => validateIdentifier("9933", "EL094014201")).not.toThrow();
    expect(() => validateIdentifier("9933", "EL0940142")).toThrow("Greek VAT number must have the format");
  });

  it("only take the company's own VAT number", () => {
    for (const [scheme, identifier] of [["9933", "EL094014201"], ["9929", "CZ12345678"], ["9943", "MT12345678"]]) {
      expect(() => validateIdentifierBelongsToCompany({ scheme: scheme!, identifier: identifier!, company: belgian })).toThrow(
        "must match the company VAT number"
      );
    }
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9933", identifier: "GR094014201", company: { vatNumber: "EL094014201", enterpriseNumber: null } })
    ).not.toThrow();
  });

  it("take the French VAT number, and require the company to have one", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9957", identifier: "FR40303265045", company: { vatNumber: null, enterpriseNumber: "303265045" } })
    ).toThrow("requires a company VAT number");
  });

  it("refuse schemes the code list removed", () => {
    expect(() => validateIdentifier("9955", "SE556732170701")).toThrow("removed from the Peppol participant identifier code list");
    expect(() => validateIdentifier("0213", "FI02454583")).toThrow("removed");
  });
});

describe("an enterprise number scheme of another country", () => {
  it("is named as such when the company's country is known", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({
        scheme: "0192",
        identifier: "974760673",
        company: { vatNumber: "DK10150817", enterpriseNumber: "10150817", country: "DK" },
      })
    ).toThrow("Scheme 0192 is for enterprise numbers from Norway");
  });
});

describe("prefixes a scheme does not carry", () => {
  it("are dropped from the published value", () => {
    expect(normalizeIdentifierValue("0184", "dk10150817")).toBe("10150817");
    expect(normalizeIdentifierValue("9919", "fn93363z")).toBe("93363z");
    expect(normalizeIdentifierValue("9925", "be0202239951")).toBe("be0202239951");
  });

  it("do not stop a number from matching the company's own", () => {
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "0184", identifier: "10150817", company: { vatNumber: null, enterpriseNumber: "DK10150817" } })
    ).not.toThrow();
    expect(() =>
      validateIdentifierBelongsToCompany({ scheme: "9919", identifier: "fn93363z", company: { vatNumber: null, enterpriseNumber: "93363z" } })
    ).not.toThrow();
  });
});

describe("a company's own numbers", () => {
  it("carry the country's VAT prefix", () => {
    expect(() => validateCompanyNumbers({ country: "BE", vatNumber: "NL123456789B01" })).toThrow("does not match the selected country");
    expect(() => validateCompanyNumbers({ country: "BE", vatNumber: "0202239951" })).toThrow("must start with a country code");
    expect(() => validateCompanyNumbers({ country: "GR", vatNumber: "EL094014201" })).not.toThrow();
    expect(() => validateCompanyNumbers({ country: "GR", vatNumber: "GR094014201" })).not.toThrow();
    expect(() => validateCompanyNumbers({ country: "GB", vatNumber: "XI220430231" })).not.toThrow();
  });

  it("are held to the scheme the company names for its enterprise number, if it is not the country's", () => {
    // The Dutch OIN is 20 digits, a GLN is checked as a GLN.
    expect(() =>
      validateCompanyNumbers({ country: "NL", enterpriseNumber: "00000001003214345000", enterpriseNumberScheme: "0190" })
    ).not.toThrow();
    expect(() => validateCompanyNumbers({ country: "AT", enterpriseNumber: "4000001000005", enterpriseNumberScheme: "0088" })).not.toThrow();
    expect(() => validateCompanyNumbers({ country: "AT", enterpriseNumber: "4000001000006", enterpriseNumberScheme: "0088" })).toThrow(
      "GLN has an invalid check digit"
    );
    expect(() => validateCompanyNumbers({ country: "AT", enterpriseNumber: "4000001000005", enterpriseNumberScheme: null })).toThrow(
      "Austrian company register number"
    );
    // A French company's number is its SIREN, whichever French scheme it names.
    expect(() => validateCompanyNumbers({ country: "FR", enterpriseNumber: "30326504500011", enterpriseNumberScheme: "0002" })).toThrow(
      "French SIREN"
    );
  });
});

// The country change module reaches the database on import, which these checks have
// no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { planCompanyCountryChange } = await import("../data/company-country-change");

describe("a country change", () => {
  const base = {
    oldCompany: {
      country: "BE",
      enterpriseNumber: "0202239951",
      vatNumber: "BE0202239951",
      enterpriseNumberScheme: "0208",
      accessPointProvider: "recommand-ap1" as const,
      smpProvider: "recommand-smp1" as const,
    },
    teamExtension: { isPlayground: false, useTestNetwork: false },
    verificationStarted: false,
    networkRegistered: false,
  };

  it("refuses to keep a VAT identifier the company no longer owns", () => {
    expect(() =>
      planCompanyCountryChange({
        ...base,
        newCountry: "NL",
        enterpriseNumber: "59581883",
        vatNumber: "NL123456789B01",
        identifiers: [{ id: "lu", scheme: "9938", identifier: "lu15027442" }],
      })
    ).toThrow("Identifier 9938:lu15027442 is not valid for a company in NL");
  });

  it("recognises a stored Danish default written with its DK prefix", () => {
    const plan = planCompanyCountryChange({
      ...base,
      oldCompany: { ...base.oldCompany, country: "DK", enterpriseNumber: "DK10150817", vatNumber: "DK10150817", enterpriseNumberScheme: "0184" },
      newCountry: "BE",
      enterpriseNumber: "0202239951",
      vatNumber: "BE0202239951",
      identifiers: [{ id: "cvr", scheme: "0184", identifier: "dk10150817" }],
    });
    expect(plan.deleteIdentifierIds).toEqual(["cvr"]);
  });
});
