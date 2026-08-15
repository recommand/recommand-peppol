import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
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
    profile,
  }: {
    selfBillingInvoice: SelfBillingInvoice;
    senderAddress: string;
    recipientAddress: string;
    isDocumentValidationEnforced: boolean;
    profile: XmlProfile;
  }): string {
  // The self billing invoice is the same as the invoice with a different invoice type code (389 instead of 380)
  const ublInvoice = prebuildInvoiceUBL({
    invoice: selfBillingInvoice,
    supplierAddress: recipientAddress,
    customerAddress: senderAddress,
    isDocumentValidationEnforced,
    profile,
  });

  // Set the invoice type code to 389
  ublInvoice.Invoice["cbc:InvoiceTypeCode"] = "389";
  
  return builder.build(ublInvoice);
}
