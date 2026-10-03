import { UserFacingError } from "@peppol/utils/util";
import type { Invoice } from "../invoice/schemas";
import type { CreditNote } from "../creditnote/schemas";
import { resolveBuyerReference } from "../buyer-reference";

/**
 * The fields XRechnung makes mandatory beyond EN 16931 that a document can be
 * missing, checked before it is written so the caller gets every one of them in a
 * single answer instead of a list of failed BR-DE rules after transmission.
 *
 * Only what the JSON model can leave out is checked here. Everything else, including
 * the VAT and tax registration rules, is left to validation of the written document.
 */
export function assertXRechnungRequirements(
  document: Invoice | CreditNote,
  customerAddress: string,
): void {
  const missing: string[] = [];
  const documentNumber = "creditNoteNumber" in document ? document.creditNoteNumber : document.invoiceNumber;

  if (
    !resolveBuyerReference({
      buyerReference: document.buyerReference,
      purchaseOrderReference: document.purchaseOrderReference,
      documentNumber,
      customerAddress,
    })
  ) {
    missing.push("buyerReference (BT-10, BR-DE-15): the buyer's routing reference, or its Leitweg-ID for a public authority");
  }
  if (!document.paymentMeans?.length) {
    missing.push("paymentMeans (BG-16, BR-DE-1): at least one payment instruction");
  }
  if (!document.seller.phone?.trim()) {
    missing.push("seller.phone (BT-42, BR-DE-6)");
  }
  if (!document.seller.email?.trim()) {
    missing.push("seller.email (BT-43, BR-DE-7)");
  }
  if (!document.seller.city?.trim()) {
    missing.push("seller.city (BT-37, BR-DE-3)");
  }
  if (!document.seller.postalZone?.trim()) {
    missing.push("seller.postalZone (BT-38, BR-DE-4)");
  }
  if (!document.buyer.city?.trim()) {
    missing.push("buyer.city (BT-52, BR-DE-8)");
  }
  if (!document.buyer.postalZone?.trim()) {
    missing.push("buyer.postalZone (BT-53, BR-DE-9)");
  }

  if (missing.length > 0) {
    throw new UserFacingError(
      `An XRechnung document requires the following fields, which are missing: ${missing.join("; ")}.`
    );
  }
}
