import { UserFacingError } from "@peppol/utils/util";
import { parsePeppolAddress } from "./peppol-address";

/** The Leitweg-ID scheme, which addresses the invoice reception of a German public authority. */
export const LEITWEG_ID_SCHEME = "0204";

/**
 * The Leitweg-ID a buyer is addressed by, or null when the buyer's endpoint is not
 * under the Leitweg-ID scheme. Uppercase, as parsePeppolAddress writes identifiers
 * into the document, with its hyphens kept.
 */
export function buyerLeitwegId(customerAddress: string | null | undefined): string | null {
  if (!customerAddress?.includes(":")) {
    return null;
  }
  const { schemeId, identifier } = parsePeppolAddress(customerAddress);
  return schemeId === LEITWEG_ID_SCHEME ? identifier : null;
}

/**
 * The value written as BT-10 Buyer reference, or null to leave it out.
 *
 * A buyer addressed by a Leitweg-ID is a German public authority, and XRechnung
 * (BR-DE-15) and the federal invoice portals require that same Leitweg-ID in BT-10.
 * It is filled in when the caller left it out, and a different buyer reference is
 * refused rather than overwritten, since it would be rejected at the authority.
 *
 * Every other buyer keeps the existing behaviour: the given buyer reference, or the
 * document number when neither a buyer reference nor a purchase order reference is
 * given, which satisfies the Peppol rule that one of the two is present.
 */
export function resolveBuyerReference({
  buyerReference,
  purchaseOrderReference,
  documentNumber,
  customerAddress,
}: {
  buyerReference?: string | null;
  purchaseOrderReference?: string | null;
  documentNumber: string;
  customerAddress: string | null | undefined;
}): string | null {
  const leitwegId = buyerLeitwegId(customerAddress);
  const given = buyerReference?.trim() || null;

  if (leitwegId) {
    if (given && given.toUpperCase() !== leitwegId) {
      throw new UserFacingError(
        `The buyer ${LEITWEG_ID_SCHEME}:${leitwegId} is a German public authority, which requires its Leitweg-ID ${leitwegId} as buyer reference (BT-10). Got buyerReference '${given}'. Leave buyerReference out to have it filled in, or set it to the Leitweg-ID. Other references, such as an order number, belong in purchaseOrderReference.`
      );
    }
    return given ?? leitwegId;
  }

  if (given) {
    return given;
  }
  return purchaseOrderReference ? null : documentNumber;
}
