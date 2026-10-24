import { COUNTRIES } from "@peppol/utils/countries";
import { validateIdentifier } from "@peppol/utils/identifier-validation";
import { countryIdentifierRules, getCountryIdentifierRules } from "@peppol/utils/identifiers/countries";
import { PEPPOL_VAT_SCHEMES } from "@peppol/utils/identifiers/peppol-schemes";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { SendingFailure } from "./errors";

type Party = {
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  enterpriseNumberScheme?: string | null;
} | null | undefined;

// Self-billing reverses the roles: the buyer issues the document, and the seller
// receives it.
const SELF_BILLING_TYPES = new Set(["selfBillingInvoice", "selfBillingCreditNote"]);

/**
 * The electronic address (BT-49, or BT-34 when self-billing) a structured document
 * delivered by email alone names for the party receiving it. Without a Peppol recipient
 * there is no address the caller gave us, yet EN 16931 requires one, so it is taken from
 * the document, first match wins:
 *
 * 1. the party's enterprise number under its scheme;
 * 2. the party's VAT number under its country's VAT scheme: the country its prefix
 *    names, or the party's own country for a number written without one, which then
 *    gets that country's prefix;
 * 3. the first address the email goes to, under scheme EM.
 *
 * Peppol BIS does not accept an email address there (rule PEPPOL-EN16931-CL008), so a
 * Peppol BIS document whose receiving party has neither number is refused with a message
 * saying how to fix it, rather than with that rule.
 */
export function emailRecipientAddress(options: {
  documentType: AnyDocumentType;
  document: { buyer?: Party; seller?: Party };
  format: AnyDocumentFormat;
  emailTo: string[];
}): string {
  const { documentType, document, format, emailTo } = options;
  const isSelfBilling = SELF_BILLING_TYPES.has(documentType.key);
  const party = isSelfBilling ? document.seller : document.buyer;

  if (party?.enterpriseNumber?.trim() && party.enterpriseNumberScheme) {
    const scheme = party.enterpriseNumberScheme;
    return `${scheme}:${enterpriseIdentifier(scheme, party.enterpriseNumber)}`;
  }

  const vatAddress = vatNumberAddress(party);
  if (vatAddress) {
    return vatAddress;
  }

  // The pipeline only gets here with at least one email address.
  const email = emailTo[0]?.trim();
  if (email && acceptsEmailAddress(format)) {
    return `EM:${email}`;
  }

  const field = isSelfBilling ? "seller" : "buyer";
  const remedy = party?.vatNumber?.trim()
    ? `The ${field}'s VAT number names no country with a Peppol VAT scheme. Provide its enterpriseNumber and enterpriseNumberScheme`
    : `Provide the ${field}'s vatNumber, or its enterpriseNumber and enterpriseNumberScheme`;
  throw new SendingFailure(
    `Peppol BIS documents need the ${field}'s electronic address, and do not accept an email address for it. ${remedy}, or choose a doctypeId that accepts an email address, such as XRechnung.`,
    400,
  );
}

/**
 * An enterprise number as its scheme writes it. Most schemes take the bare number, so
 * the dots, spaces and dashes people type are dropped. A few keep a separator as part of
 * the identifier, such as the hyphens of a Leitweg-ID (0204), which BT-10 is copied from
 * as well; for those the number keeps the form the scheme's validator accepts.
 */
function enterpriseIdentifier(scheme: string, enterpriseNumber: string): string {
  const cleaned = cleanEnterpriseNumber(enterpriseNumber)!;
  const written = enterpriseNumber.trim().toUpperCase();
  if (written !== cleaned && isValidIdentifier(scheme, written) && !isValidIdentifier(scheme, cleaned)) {
    return written;
  }
  return cleaned;
}

function isValidIdentifier(scheme: string, identifier: string): boolean {
  try {
    validateIdentifier(scheme, identifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * The party's VAT number as a Peppol identifier, under its country's default VAT scheme,
 * or the national VAT scheme of the code list for a country without one. The country is
 * the one the number's prefix names, which is what makes it that country's VAT number,
 * whatever the party's address says. A number written without a prefix is taken as one
 * of the party's own country, and gets that country's prefix, which the VAT schemes
 * require. The VAT identifier itself (BT-48) is written as given, and EN 16931 wants
 * the prefix there as well (BR-CO-09), so such a document is refused for that field,
 * which names the actual problem. Null when no country or no VAT scheme is found.
 */
function vatNumberAddress(party: Party): string | null {
  const vatNumber = cleanVatNumber(party?.vatNumber);
  if (!vatNumber) return null;

  const prefix = vatNumber.slice(0, 2);
  if (/^[A-Z]{2}$/.test(prefix)) {
    const country = countryOfVatPrefix(prefix);
    const scheme = country ? vatSchemeFor(country) : null;
    return scheme ? `${scheme}:${vatNumber}` : null;
  }

  const country = party?.country?.trim().toUpperCase();
  const scheme = country ? vatSchemeFor(country) : null;
  if (!country || !scheme) return null;
  const countryPrefix = getCountryIdentifierRules(country)?.vatPrefixes?.[0] ?? country;
  return `${scheme}:${countryPrefix}${vatNumber}`;
}

/** The country a VAT prefix belongs to: its own code, or a prefix such as Greece's EL. */
function countryOfVatPrefix(prefix: string): string | null {
  const byPrefix = countryIdentifierRules.find((rules) => rules.vatPrefixes?.includes(prefix));
  if (byPrefix) return byPrefix.country;
  const known =
    COUNTRIES.some((info) => info.code === prefix) ||
    Object.values(PEPPOL_VAT_SCHEMES).includes(prefix);
  return known ? prefix : null;
}

function vatSchemeFor(country: string): string | null {
  const defaultScheme = COUNTRIES.find((info) => info.code === country)?.defaultVatScheme;
  if (defaultScheme) return defaultScheme;
  return (
    Object.entries(PEPPOL_VAT_SCHEMES).find(([, schemeCountry]) => schemeCountry === country)?.[0] ??
    null
  );
}

/**
 * Peppol BIS restricts the electronic address schemes to the ones a participant can be
 * registered under, which leaves out EM. The other formats, XRechnung and SI-UBL among
 * them, take the full EN 16931 list.
 */
function acceptsEmailAddress(format: AnyDocumentFormat): boolean {
  return !format.key.startsWith("peppol-ubl-");
}
