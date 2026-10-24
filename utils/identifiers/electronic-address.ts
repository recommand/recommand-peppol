import { validateIdentifier } from "@peppol/utils/identifier-validation";
import { cleanEnterpriseNumber } from "@peppol/utils/util";
import { vatNumberIdentifier } from "./vat-number";

export type AddressableParty = {
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  enterpriseNumberScheme?: string | null;
} | null | undefined;

/**
 * The electronic address a party's own numbers give it, as `scheme:identifier`: its
 * enterprise number under its scheme, or else its VAT number as a Peppol identifier
 * (see vatNumberIdentifier). The address is written into a document, not registered,
 * so a country without a default VAT scheme falls back to the code list's. Null when
 * the party has neither number in a usable form.
 */
export function partyElectronicAddress(party: AddressableParty): string | null {
  if (cleanEnterpriseNumber(party?.enterpriseNumber) && party?.enterpriseNumberScheme) {
    const scheme = party.enterpriseNumberScheme;
    return `${scheme}:${enterpriseNumberIdentifier(scheme, party.enterpriseNumber!)}`;
  }

  const vat = vatNumberIdentifier(party?.country, party?.vatNumber, { schemes: "codeList" });
  return vat ? `${vat.scheme}:${vat.identifier}` : null;
}

/**
 * An enterprise number as its scheme writes it. Most schemes take the bare number, so
 * the dots, spaces and dashes people type are dropped. A few keep a separator as part of
 * the identifier, such as the hyphens of a Leitweg-ID (0204), which a buyer reference
 * is copied from as well; for those the number keeps the form the scheme's validator
 * accepts.
 */
function enterpriseNumberIdentifier(scheme: string, enterpriseNumber: string): string {
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
