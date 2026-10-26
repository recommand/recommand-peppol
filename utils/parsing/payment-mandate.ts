import { getNullableTextContent } from "./xml-helpers";

/**
 * The mandate of a UBL payment means (cac:PaymentMandate). Its reference (BT-89) is
 * optional in UBL, and PEPPOL-EN16931-R061 requires it only on a direct debit, so a
 * received document can carry a mandate without one. Such a mandate is read as none,
 * as in CII, where the debited account alone does not make a mandate either.
 */
export function parseUblPaymentMandate(mandate: any) {
  const reference = getNullableTextContent(mandate?.ID);
  if (!reference) return null;
  return {
    reference,
    debitedAccount: getNullableTextContent(mandate.PayerFinancialAccount?.ID),
  };
}
