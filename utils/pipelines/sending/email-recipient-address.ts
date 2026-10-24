import { partyElectronicAddress, type AddressableParty } from "@peppol/utils/identifiers/electronic-address";
import { getDocumentFormatsByDocumentTypeKey } from "@peppol/utils/type-repository/document-formats";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { SendingFailure } from "./errors";

// Self-billing reverses the roles: the buyer issues the document, and the seller
// receives it.
const SELF_BILLING_TYPES = new Set(["selfBillingInvoice", "selfBillingCreditNote"]);

/**
 * The electronic address (BT-49, or BT-34 when self-billing) a structured document
 * delivered by email alone names for the party receiving it. Without a Peppol recipient
 * there is no address the caller gave us, yet EN 16931 requires one. It is the address
 * the party's own numbers give it (see partyElectronicAddress), or else the first
 * address the email goes to, under scheme EM, in a format that accepts one.
 *
 * A format that does not accept an email address there (see acceptsEmailEndpoint) and
 * a party with no usable number is refused with a message saying how to fix it, rather
 * than with the format's own rule.
 */
export function emailRecipientAddress(options: {
  documentType: AnyDocumentType;
  document: { buyer?: AddressableParty; seller?: AddressableParty };
  format: AnyDocumentFormat;
  emailTo: string[];
}): string {
  const { documentType, document, format, emailTo } = options;
  const isSelfBilling = SELF_BILLING_TYPES.has(documentType.key);
  const party = isSelfBilling ? document.seller : document.buyer;

  const address = partyElectronicAddress(party);
  if (address) {
    return address;
  }

  // The pipeline only gets here with at least one email address.
  const email = emailTo[0]?.trim();
  if (email && format.acceptsEmailEndpoint) {
    return `EM:${email}`;
  }

  const field = isSelfBilling ? "seller" : "buyer";
  const remedies = [
    party?.vatNumber?.trim()
      ? `The ${field}'s VAT number cannot be used as a Peppol identifier. Provide its enterpriseNumber and enterpriseNumberScheme`
      : `Provide the ${field}'s vatNumber, or its enterpriseNumber and enterpriseNumberScheme`,
  ];
  // Only formats that carry this document type are a way out.
  const formatsAcceptingEmail = getDocumentFormatsByDocumentTypeKey(documentType.key)
    .filter((candidate) => candidate.acceptsEmailEndpoint)
    .map((candidate) => candidate.translatableTitle);
  if (formatsAcceptingEmail.length > 0) {
    remedies.push(`choose a doctypeId whose format accepts an email address: ${listOf(formatsAcceptingEmail)}`);
  }
  throw new SendingFailure(
    `${format.translatableTitle} needs the ${field}'s electronic address, and does not accept an email address for it. ${remedies.join(", or ")}.`,
    400,
  );
}

function listOf(items: string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}
