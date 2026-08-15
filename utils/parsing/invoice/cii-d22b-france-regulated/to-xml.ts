import { frenchRegulatedBillingDocumentToCII } from "../../cii-d22b/france-regulated/to-xml";
import type { Invoice } from "../schemas";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function frenchRegulatedInvoiceToCII({
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
  return frenchRegulatedBillingDocumentToCII({
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
