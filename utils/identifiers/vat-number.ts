import { COUNTRIES } from "@peppol/utils/countries";
import { cleanVatNumber } from "@peppol/utils/util";
import { countryIdentifierRules, getCountryIdentifierRules } from "./countries";
import { PEPPOL_VAT_SCHEMES } from "./peppol-schemes";

/**
 * Which VAT schemes a VAT number may become an identifier under. `default` is each
 * country's default VAT scheme only, the schemes companies are registered under by
 * default: a country without one does not address its companies by VAT number.
 * `codeList` falls back to the national VAT scheme of the Peppol code list for such a
 * country, for an address written into a document rather than registered on the network.
 */
export type VatSchemePolicy = "default" | "codeList";

/**
 * A VAT number as a Peppol participant identifier: under its country's VAT scheme (see
 * VatSchemePolicy), written with that country's prefix. Null when the number names no
 * country, or the policy gives its country no scheme.
 *
 * The country is the one the number's prefix names, Greece for EL as well as GR. A
 * number written without a prefix is taken as one of `country`, and gets that country's
 * prefix, which the VAT schemes require. A company's VAT number is held to its own
 * country's prefix, so for a company this is the number under its country's scheme.
 */
export function vatNumberIdentifier(
  country: string | null | undefined,
  vatNumber: string | null | undefined,
  { schemes = "default" }: { schemes?: VatSchemePolicy } = {},
): { scheme: string; identifier: string } | null {
  const cleaned = cleanVatNumber(vatNumber);
  if (!cleaned) return null;

  const hasPrefix = /^[A-Z]{2}/.test(cleaned);
  const vatCountry = hasPrefix ? countryOfVatPrefix(cleaned.slice(0, 2)) : country?.trim().toUpperCase() || null;
  if (!vatCountry) return null;

  const scheme = vatSchemeFor(vatCountry, schemes);
  if (!scheme) return null;

  const prefix = getCountryIdentifierRules(vatCountry)?.vatPrefixes?.[0] ?? vatCountry;
  return { scheme, identifier: hasPrefix ? cleaned : `${prefix}${cleaned}` };
}

function vatSchemeFor(country: string, schemes: VatSchemePolicy): string | null {
  const defaultScheme = COUNTRIES.find((info) => info.code === country)?.defaultVatScheme;
  if (defaultScheme || schemes === "default") return defaultScheme ?? null;
  return Object.entries(PEPPOL_VAT_SCHEMES).find(([, schemeCountry]) => schemeCountry === country)?.[0] ?? null;
}

/**
 * The country a VAT number prefix belongs to: its own code, or a prefix such as Greece's
 * EL. Countries the code list has a VAT scheme for count too, whether or not they are in
 * our country list.
 */
function countryOfVatPrefix(prefix: string): string | null {
  const byPrefix = countryIdentifierRules.find((rules) => rules.vatPrefixes?.includes(prefix));
  if (byPrefix) return byPrefix.country;
  const known =
    COUNTRIES.some((info) => info.code === prefix) ||
    Object.values(PEPPOL_VAT_SCHEMES).includes(prefix);
  return known ? prefix : null;
}
