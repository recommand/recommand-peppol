import { frenchRegulatedBillingDocumentToUBL } from "../../ubl-france-regulated/to-xml";
import { prebuildInvoiceUBL } from "../peppol-ubl-bis3/to-xml";
import type { Invoice } from "../schemas";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

export function frenchRegulatedInvoiceToUBL({
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
  return frenchRegulatedBillingDocumentToUBL({
    document: invoice,
    profile,
    rootName: "Invoice",
    ublDocument: prebuildInvoiceUBL({
      invoice,
      supplierAddress: senderAddress,
      customerAddress: recipientAddress,
      isDocumentValidationEnforced,
      profile,
    }),
  });
}
