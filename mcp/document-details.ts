import { getDocumentType } from "@peppol/utils/type-repository/document-types";

/** The currency billing documents carry; the email details only hold a placeholder for it. */
const currencyOf = (parsed: unknown) =>
  parsed && typeof parsed === "object" && "currency" in parsed && typeof parsed.currency === "string" ? parsed.currency : null;

/** Who a document is between, its number and how much it's for, as a model tells documents apart by them. */
export const documentDetails = (type: string, parsed: unknown) => {
  const documentType = parsed ? getDocumentType(type) : undefined;
  const details = documentType?.email?.extractDocumentDetails(parsed as never);
  const counterparties = documentType?.extractCounterparties(parsed as never);

  return {
    amount: details?.amount ?? null,
    currency: currencyOf(parsed),
    documentNumber: documentType?.extractDocumentNumber(parsed as never) ?? null,
    receiverName: counterparties?.receiverName ?? null,
    senderName: counterparties?.senderName ?? null,
  };
};
