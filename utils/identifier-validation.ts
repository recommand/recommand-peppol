import { COUNTRIES, getCountryName } from "@peppol/utils/countries";
import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { countryIdentifierRules, getCountryIdentifierRules } from "./identifiers/countries";
import { validateGln, validateIban } from "./identifiers/international";
import { PEPPOL_VAT_SCHEMES, REMOVED_SCHEMES } from "./identifiers/peppol-schemes";
import type { IdentifierValidator } from "./identifiers/validators";

// The rules themselves live in ./identifiers: the check digit algorithms, the validator
// building blocks, and one file per country registered in ./identifiers/countries. This
// module applies them to companies and their Peppol identifiers.

export { passesLuhn } from "./identifiers/checksums";
export { getFrenchSiren, isSiren, isSiret } from "./identifiers/countries/france";
export { validateLeitwegId } from "./identifiers/countries/germany";

/**
 * Validators per Peppol participant identifier scheme (ISO/IEC 6523 ICD). Every national
 * VAT scheme takes its country's VAT number validator and every country's default
 * enterprise number scheme its enterprise number validator; a country's own schemes,
 * the removed schemes and the international ones come after.
 */
const schemeValidators: Record<string, IdentifierValidator> = {
  ...Object.fromEntries(
    [
      ...Object.entries(PEPPOL_VAT_SCHEMES).map(([scheme, country]) => [scheme, getCountryIdentifierRules(country)?.vatNumber] as const),
      ...COUNTRIES.map((country) => [country.defaultEnterpriseNumberScheme, getCountryIdentifierRules(country.code)?.enterpriseNumber] as const),
    ].filter(([scheme, validator]) => scheme && validator)
  ),
  ...Object.assign({}, ...countryIdentifierRules.map((rules) => rules.schemes ?? {})),
  ...Object.fromEntries(
    Object.entries(REMOVED_SCHEMES).map(([scheme, replacement]) => [
      scheme,
      () => {
        throw new UserFacingError(
          `Scheme ${scheme} was removed from the Peppol participant identifier code list and can no longer be used. ${replacement}`
        );
      },
    ])
  ),
  "0088": validateGln,
  "9918": validateIban,
};

export function validateIdentifier(
  scheme: string,
  identifier: string,
): void {
  const validator = schemeValidators[scheme];
  if (!validator) {
    return;
  }
  validator(identifier);
}

export function validateCountryIdentifier(
  country: string,
  identifiers: {
    vatNumber?: string | null;
    enterpriseNumber?: string | null;
  },
): void {
  const rules = getCountryIdentifierRules(country);
  if (!rules) {
    return;
  }
  if (identifiers.vatNumber && rules.vatNumber) {
    rules.vatNumber(identifiers.vatNumber);
  }
  if (identifiers.enterpriseNumber && rules.enterpriseNumber) {
    rules.enterpriseNumber(identifiers.enterpriseNumber);
  }
}

/** The schemes that belong to a country: its default enterprise number scheme and its own. */
function countrySchemes(country: string): string[] {
  const rules = getCountryIdentifierRules(country);
  return [
    COUNTRIES.find((entry) => entry.code === country.toUpperCase())?.defaultEnterpriseNumberScheme,
    ...Object.keys(rules?.schemes ?? {}),
    ...(rules?.companyIdentifiers?.schemes ?? []),
  ].filter((scheme): scheme is string => !!scheme);
}

/**
 * Holds a company's VAT number and enterprise number against its country: the VAT
 * number has to carry the country's prefix, and both have to pass the country's
 * national rules.
 */
export function validateCompanyNumbers({
  country,
  vatNumber,
  enterpriseNumber,
  enterpriseNumberScheme,
}: {
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  /** The scheme the company names its enterprise number under; null leaves it to the country. */
  enterpriseNumberScheme?: string | null;
}): void {
  if (vatNumber && !/^[A-Z]{2}/.test(vatNumber)) {
    throw new UserFacingError("VAT number must start with a country code (e.g. BE, NL, DE)");
  }
  if (vatNumber && country && !getVatNumberPrefixes(country).includes(vatNumber.substring(0, 2).toUpperCase())) {
    throw new UserFacingError(`VAT number country code (${vatNumber.substring(0, 2)}) does not match the selected country (${country})`);
  }
  if (!country) {
    return;
  }
  // An enterprise number under a scheme of another country or of no country, such as a
  // GLN or the Dutch OIN, is held to that scheme instead of the country's register. Under
  // one of the country's own schemes it is the country's enterprise number, as a SIREN
  // is under the French 0002, or the register number German companies once named 0204.
  const otherScheme =
    enterpriseNumberScheme && !countrySchemes(country).includes(enterpriseNumberScheme) ? enterpriseNumberScheme : null;
  if (enterpriseNumber && otherScheme) {
    validateIdentifier(otherScheme, enterpriseNumber);
  }
  validateCountryIdentifier(country, {
    vatNumber,
    enterpriseNumber: otherScheme ? null : enterpriseNumber,
  });
}

/** The prefixes a country's VAT numbers carry: its code, unless its rules name others. */
export function getVatNumberPrefixes(country: string): string[] {
  return getCountryIdentifierRules(country)?.vatPrefixes ?? [country.toUpperCase()];
}

type NationalNumberScheme = { country: string; number: "vatNumber" | "enterpriseNumber" };

/**
 * The schemes whose identifier is a company's own national number: every country's
 * default enterprise number scheme, and every national VAT scheme of the code list.
 */
const nationalNumberSchemes: Record<string, NationalNumberScheme> = {
  ...Object.fromEntries(
    COUNTRIES.flatMap((country) =>
      country.defaultEnterpriseNumberScheme
        ? [[country.defaultEnterpriseNumberScheme, { country: country.code, number: "enterpriseNumber" }]]
        : []
    )
  ),
  ...Object.fromEntries(
    Object.entries(PEPPOL_VAT_SCHEMES).map(([scheme, country]) => [scheme, { country, number: "vatNumber" }])
  ),
};

/** Per scheme, the prefix the published identifier goes without, from the countries' rules. */
const optionalPrefixes: Record<string, RegExp> = Object.assign(
  {},
  ...countryIdentifierRules.map((rules) => rules.optionalPrefixes ?? {})
);

/**
 * The value an identifier is stored and published under: the cleaned identifier
 * without a prefix its scheme does not carry.
 */
export function normalizeIdentifierValue(scheme: string, identifier: string): string {
  return identifier.replace(optionalPrefixes[scheme] ?? /^$/, "");
}

/** A country's name as it reads in a sentence: "the Netherlands", "Belgium". */
function countryInProse(code: string): string {
  const name = getCountryName(code);
  return ["NL", "GB", "US", "AE"].includes(code) ? `the ${name}` : name;
}

/**
 * Holds an identifier against the numbers of the company that registers it. Under a
 * scheme that names a national VAT number or business register number, the identifier
 * has to be the company's own: we verify a company by those numbers, so publishing any
 * other would let it receive documents addressed to someone else.
 *
 * That includes the schemes of other countries. A company has one VAT number and one
 * enterprise number, both of its own country, so a VAT registration it holds abroad
 * cannot be checked against anything it was verified by. A company registered for VAT
 * in another country is created as a company of that country.
 *
 * Schemes that name no national number (GLN, IBAN, Leitweg-ID, ...) are left to their
 * format.
 */
export function validateIdentifierBelongsToCompany({
  scheme,
  identifier,
  company,
}: {
  scheme: string;
  identifier: string;
  /** country, when known, makes the message name a scheme of another country as such. */
  company: { enterpriseNumber: string | null; vatNumber: string | null; country?: string | null };
}): void {
  const companyIdentifiers = countryIdentifierRules.find((rules) =>
    rules.companyIdentifiers?.schemes.includes(scheme)
  )?.companyIdentifiers;
  if (companyIdentifiers) {
    companyIdentifiers.validate(scheme, identifier, company);
    return;
  }

  const national = nationalNumberSchemes[scheme];
  if (!national) {
    return;
  }

  const label = national.number === "vatNumber" ? "VAT number" : "enterprise number";
  const normalizeVatNumber =
    getCountryIdentifierRules(national.country)?.normalizeVatNumber ?? ((vatNumber: string) => vatNumber);
  const clean = (value: string | null) => {
    const cleaned = national.number === "vatNumber" ? cleanVatNumber(value) : cleanEnterpriseNumber(value);
    if (!cleaned) {
      return null;
    }
    return normalizeIdentifierValue(scheme, national.number === "vatNumber" ? normalizeVatNumber(cleaned) : cleaned);
  };
  const companyNumber = clean(company[national.number]);

  if (!companyNumber) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company ${label} to be set.`);
  }

  const cleanedIdentifier = clean(identifier);
  if (cleanedIdentifier !== companyNumber) {
    const foreign = company.country
      ? company.country.toUpperCase() !== national.country
      : national.number === "vatNumber" && !getVatNumberPrefixes(national.country).some((prefix) => companyNumber.startsWith(prefix));
    const country = countryInProse(national.country);
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must match the company ${label}. Expected: ${companyNumber}, got: ${cleanedIdentifier}` +
        (foreign
          ? `. Scheme ${scheme} is for ${label}s from ${country}, and a company can only register its own. Register a ${label} from ${country} on a separate company in that country.`
          : "")
    );
  }
}
