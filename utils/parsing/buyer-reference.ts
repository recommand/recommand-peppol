import { UserFacingError } from "@peppol/utils/util";
import { validateLeitwegId } from "@peppol/utils/identifiers/countries/germany";
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
 * (BR-DE-15) and the federal invoice portals require a Leitweg-ID in BT-10. The
 * authority routes the invoice internally on that Leitweg-ID, which is often the one
 * it is addressed by on Peppol but need not be: the KoSIT guideline on Peppol
 * identifiers in Germany (section 3.2.2) has an authority reached at
 * 0204:04000000-FHBXLAND-82 that expects 04000000-900X44X06-60 in BT-10. So the
 * recipient's Leitweg-ID is filled in when the caller left BT-10 out, a different
 * Leitweg-ID is kept, and anything that is not a Leitweg-ID is refused, since the
 * authority would reject it.
 *
 * Every other buyer gets the given buyer reference or, when there is none, the
 * document number in two cases: when no purchase order reference is given either,
 * which satisfies the Peppol rule that one of the two is present, and when seller and
 * buyer are both located in Germany, where Peppol BIS (DE-R-015) and XRechnung
 * (BR-DE-15) require BT-10 itself. The German tax administration accepts a
 * placeholder there for business buyers, which use no Leitweg-ID.
 */
export function resolveBuyerReference({
  buyerReference,
  purchaseOrderReference,
  documentNumber,
  customerAddress,
  sellerCountry,
  buyerCountry,
}: {
  buyerReference?: string | null;
  purchaseOrderReference?: string | null;
  documentNumber: string;
  customerAddress: string | null | undefined;
  /** BT-40, the country DE-R-015 reads to tell whether the seller is in Germany. */
  sellerCountry?: string | null;
  /** BT-55, the country DE-R-015 reads to tell whether the buyer is in Germany. */
  buyerCountry?: string | null;
}): string | null {
  const leitwegId = buyerLeitwegId(customerAddress);
  const given = buyerReference?.trim() || null;

  if (leitwegId) {
    if (given && given.toUpperCase() !== leitwegId) {
      assertLeitwegIdBuyerReference(given, leitwegId);
    }
    return given ?? leitwegId;
  }

  if (given) {
    return given;
  }
  if (!purchaseOrderReference || (isGermany(sellerCountry) && isGermany(buyerCountry))) {
    return documentNumber;
  }
  return null;
}

function isGermany(country: string | null | undefined): boolean {
  return country?.trim().toUpperCase() === "DE";
}

function assertLeitwegIdBuyerReference(given: string, leitwegId: string): void {
  try {
    validateLeitwegId(given);
  } catch (error) {
    if (!(error instanceof UserFacingError)) {
      throw error;
    }
    throw new UserFacingError(
      `The buyer ${LEITWEG_ID_SCHEME}:${leitwegId} is a German public authority, which requires a Leitweg-ID as buyer reference (BT-10). Got buyerReference '${given}', which is not a valid Leitweg-ID (a 2 to 12 digit coarse address, an optional fine address and 2 check digits, such as ${leitwegId}). Leave buyerReference out to use ${leitwegId}, or set it to the Leitweg-ID the authority gave you. Other references, such as an order number, belong in purchaseOrderReference.`
    );
  }
}
