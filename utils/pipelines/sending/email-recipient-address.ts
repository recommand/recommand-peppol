import { COUNTRIES } from "@peppol/utils/countries";
import { PEPPOL_VAT_SCHEMES } from "@peppol/utils/identifiers/peppol-schemes";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { SendingFailure } from "./errors";

type Party = {
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
 * 2. the party's VAT number under the VAT scheme of the country its prefix names;
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

  const enterpriseNumber = cleanEnterpriseNumber(party?.enterpriseNumber);
  if (enterpriseNumber && party?.enterpriseNumberScheme) {
    return `${party.enterpriseNumberScheme}:${enterpriseNumber}`;
  }

  const vatNumber = cleanVatNumber(party?.vatNumber);
  const vatScheme = vatNumber ? vatSchemeFor(vatNumber) : null;
  if (vatNumber && vatScheme) {
    return `${vatScheme}:${vatNumber}`;
  }

  // The pipeline only gets here with at least one email address.
  const email = emailTo[0]?.trim();
  if (email && acceptsEmailAddress(format)) {
    return `EM:${email}`;
  }

  const field = isSelfBilling ? "seller" : "buyer";
  throw new SendingFailure(
    `Peppol BIS documents need the ${field}'s electronic address, and do not accept an email address for it. Provide the ${field}'s vatNumber, or its enterpriseNumber and enterpriseNumberScheme, or choose a doctypeId that accepts an email address, such as XRechnung.`,
    400,
  );
}

/**
 * The scheme a VAT number is a Peppol identifier under: its country's default, or the
 * national VAT scheme of the code list for a country without one. The country is the one
 * the number's prefix names, which is what makes it that country's VAT number, whatever
 * the party's address says. Greek VAT numbers start with EL.
 */
function vatSchemeFor(vatNumber: string): string | null {
  const prefix = vatNumber.slice(0, 2);
  const country = prefix === "EL" ? "GR" : prefix;
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
