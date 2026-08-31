import type { CreditNote } from "../creditnote/schemas";
import { frenchCountrySpecificSchema, type FrenchCountrySpecific } from "../country-specific/france";
import type { Invoice } from "../invoice/schemas";
import { UserFacingError } from "@directory/utils/util";

export function validateFrenchRegulatedBillingDocument(
  document: Invoice | CreditNote
): FrenchCountrySpecific {
  const countrySpecific = frenchCountrySpecificSchema.safeParse(
    document.countrySpecific
  );
  if (!countrySpecific.success) {
    throw new UserFacingError(
      "French regulated billing requires countrySpecific with country FR, a billing mode, and the structured French legal notes."
    );
  }
  if (
    !document.seller.enterpriseNumber ||
    !/^\d{9}$/.test(document.seller.enterpriseNumber) ||
    document.seller.enterpriseNumberScheme !== "0002"
  ) {
    throw new UserFacingError(
      "French regulated billing requires the seller's nine-digit SIREN as enterpriseNumber with enterpriseNumberScheme 0002."
    );
  }
  if (document.currency !== "EUR") {
    throw new UserFacingError(
      "French regulated billing currently supports EUR invoices only. Non-EUR invoices require a separate VAT total converted to EUR."
    );
  }

  return countrySpecific.data;
}
