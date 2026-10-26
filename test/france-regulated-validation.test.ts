import { describe, expect, it } from "bun:test";
import { validateFrenchRegulatedBillingDocument } from "../utils/parsing/france-regulated/validation";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import type { Invoice } from "../utils/parsing/invoice/schemas";

const party = {
  name: "Vendeur SAS",
  street: "1 Rue du Vendeur",
  city: "Paris",
  postalZone: "75001",
  country: "FR",
  vatNumber: "FR40303265045",
  enterpriseNumber: "303265045",
  enterpriseNumberScheme: "0002",
};

const countrySpecific = {
  country: "FR",
  billingMode: "B1",
  businessProcess: "REGULATED",
  recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
  latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
  earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
} as const;

const lines = [
  {
    name: "Prestation",
    quantity: "1",
    unitCode: "C62",
    netPriceAmount: "100.00",
    vat: { category: "S", percentage: "20.00" },
  },
];

function creditNote(invoiceReferences: CreditNote["invoiceReferences"]): CreditNote {
  return {
    creditNoteNumber: "A2026-001",
    issueDate: "2026-10-02",
    currency: "EUR",
    seller: party,
    buyer: { ...party, name: "Acheteur SARL" },
    lines,
    countrySpecific,
    invoiceReferences,
  } as unknown as CreditNote;
}

describe("validateFrenchRegulatedBillingDocument", () => {
  it("accepts a credit note that references the credited invoice with its date", () => {
    expect(() =>
      validateFrenchRegulatedBillingDocument(
        creditNote([{ id: "F2026-001", issueDate: "2026-10-01" }])
      )
    ).not.toThrow();
  });

  it("refuses a credit note without an invoice reference (BR-FR-CO-05)", () => {
    expect(() => validateFrenchRegulatedBillingDocument(creditNote([]))).toThrow(
      "French regulated credit notes must reference the invoice they credit"
    );
  });

  it("refuses a credit note whose invoice reference has no issue date (BR-FR-CO-05)", () => {
    expect(() =>
      validateFrenchRegulatedBillingDocument(creditNote([{ id: "F2026-001" }]))
    ).toThrow("French regulated credit notes must reference the invoice they credit");
  });

  it("does not ask an invoice for invoice references", () => {
    const invoice = {
      invoiceNumber: "F2026-001",
      issueDate: "2026-10-01",
      currency: "EUR",
      seller: party,
      buyer: { ...party, name: "Acheteur SARL" },
      lines,
      countrySpecific,
    } as unknown as Invoice;

    expect(() => validateFrenchRegulatedBillingDocument(invoice)).not.toThrow();
  });
});
