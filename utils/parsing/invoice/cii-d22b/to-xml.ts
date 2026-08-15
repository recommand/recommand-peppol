import type { Invoice } from "../schemas";
import { billingDocumentToCII } from "../../cii-d22b/to-xml";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function invoiceToCII({
  invoice,
  senderAddress,
  recipientAddress,
  isDocumentValidationEnforced,
  profile,
}: {
  invoice: Invoice;
  senderAddress: string;
  recipientAddress: string;
  isDocumentValidationEnforced: boolean;
  profile: XmlProfile;
}): string {
  return billingDocumentToCII({
    document: invoice,
    profile,
    documentNumber: invoice.invoiceNumber,
    typeCode: "380",
    supplierAddress: senderAddress,
    customerAddress: recipientAddress,
    isDocumentValidationEnforced,
    dueDate: invoice.dueDate,
  });
}
