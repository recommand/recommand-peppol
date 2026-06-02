import { SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { prebuildInvoiceUBL } from "../invoice/peppol-ubl-bis3/to-xml";
import type { SelfBillingInvoice } from "./schemas";
import { XMLBuilder } from "fast-xml-parser";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

export function selfBillingInvoiceToUBL(
  {
    selfBillingInvoice,
    senderAddress,
    recipientAddress,
    isDocumentValidationEnforced,
  }: {
    selfBillingInvoice: SelfBillingInvoice;
    senderAddress: string;
    recipientAddress: string;
    isDocumentValidationEnforced: boolean;
  }): string {
  // The self billing invoice is the same as the invoice with a different invoice type code (389 instead of 380)
  const ublInvoice = prebuildInvoiceUBL({
    invoice: selfBillingInvoice,
    supplierAddress: recipientAddress,
    customerAddress: senderAddress,
    isDocumentValidationEnforced,
  });

  // Set the CustomizationID
  ublInvoice.Invoice["cbc:CustomizationID"] = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";
  // Set the ProfileID
  ublInvoice.Invoice["cbc:ProfileID"] = SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO.processId;
  // Set the invoice type code to 389
  ublInvoice.Invoice["cbc:InvoiceTypeCode"] = "389";
  
  return builder.build(ublInvoice);
}
