import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";
import type { CreditNote } from "../../creditnote/schemas";
import type { Invoice } from "../../invoice/schemas";
import { validateFrenchRegulatedBillingDocument } from "../../france-regulated/validation";
import { billingDocumentToCII } from "../to-xml";

type FrenchRegulatedBillingDocument = Invoice | CreditNote;

export function frenchRegulatedBillingDocumentToCII({
  document,
  profile,
  documentNumber,
  typeCode,
  supplierAddress,
  customerAddress,
  isDocumentValidationEnforced,
  dueDate,
  invoiceReferences,
}: {
  document: FrenchRegulatedBillingDocument;
  profile: XmlProfile;
  documentNumber: string;
  typeCode: "380" | "381";
  supplierAddress: string;
  customerAddress: string;
  isDocumentValidationEnforced: boolean;
  dueDate?: string | null;
  invoiceReferences?: { id: string; issueDate?: string | null }[];
}): string {
  const countrySpecific = validateFrenchRegulatedBillingDocument(document);

  return billingDocumentToCII({
    document,
    profile,
    documentNumber,
    typeCode,
    supplierAddress,
    customerAddress,
    isDocumentValidationEnforced,
    dueDate,
    invoiceReferences,
    businessProcessId: countrySpecific.billingMode,
    additionalNotes: [
      {
        content: countrySpecific.recoveryCostsNote,
        subjectCode: "PMT",
      },
      {
        content: countrySpecific.latePaymentPenaltiesNote,
        subjectCode: "PMD",
      },
      {
        content: countrySpecific.earlyPaymentDiscountNote,
        subjectCode: "AAB",
      },
    ],
  });
}
