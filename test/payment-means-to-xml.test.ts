import { describe, expect, it } from "bun:test";
import type { Invoice, PaymentMeans } from "../utils/parsing/invoice/schemas";
import { invoiceToUBL } from "../utils/parsing/invoice/peppol-ubl-bis3/to-xml";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";

const profile = {
  customizationId: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
  processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
};

function invoiceWith(paymentMeans: PaymentMeans[]): Invoice {
  return {
    invoiceNumber: "PM-001",
    issueDate: "2026-01-01",
    dueDate: "2026-01-01",
    currency: "EUR",
    seller: { name: "Seller", street: "Seller Street 1", city: "Brussels", postalZone: "1000", country: "BE", vatNumber: "BE1234567894", street2: null },
    buyer: { name: "Buyer", street: "Buyer Street 1", city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE9876543210", street2: null },
    paymentMeans,
    paymentTerms: { note: "Collected by direct debit." },
    lines: [
      {
        name: "Service",
        quantity: "1",
        unitCode: "C62",
        netPriceAmount: "100.00",
        netAmount: null,
        vat: { category: "S", percentage: "21.00" },
      },
    ],
  } as Invoice;
}

function toUBL(invoice: Invoice) {
  return invoiceToUBL({ invoice, senderAddress: "0208:1234567894", recipientAddress: "0208:9876543210", isDocumentValidationEnforced: false, profile });
}

function toCII(invoice: Invoice) {
  return invoiceToCII({ invoice, senderAddress: "0208:1234567894", recipientAddress: "0208:9876543210", isDocumentValidationEnforced: false, profile });
}

describe("payment means without a payee account", () => {
  const directDebit = invoiceWith([
    { paymentMethod: "sepa_direct_debit", name: "SEPA direct debit", reference: "PM-001", iban: "", financialInstitutionBranch: null },
  ]);

  it("writes a direct debit without an account in UBL", () => {
    const xml = toUBL(directDebit);
    expect(xml).toContain("<cbc:PaymentMeansCode>59</cbc:PaymentMeansCode>");
    expect(xml).toContain("<cbc:PaymentID>PM-001</cbc:PaymentID>");
    expect(xml).not.toContain("PayeeFinancialAccount");
    expect(xml).toContain("<cbc:Note>Collected by direct debit.</cbc:Note>");
  });

  it("writes a direct debit without an account in CII", () => {
    const xml = toCII(directDebit);
    expect(xml).toContain("<ram:TypeCode>59</ram:TypeCode>");
    expect(xml).not.toContain("PayeePartyCreditorFinancialAccount");
  });

  it("keeps the account of a direct debit that has one", () => {
    const xml = toUBL(invoiceWith([
      { paymentMethod: "sepa_direct_debit", name: null, reference: "", iban: "BE71096123456769", financialInstitutionBranch: null },
    ]));
    expect(xml).toContain("<cbc:ID>BE71096123456769</cbc:ID>");
  });

  it("keeps the account element of a credit transfer, even when it is empty", () => {
    const xml = toUBL(invoiceWith([
      { paymentMethod: "credit_transfer", name: null, reference: "", iban: "", financialInstitutionBranch: null },
    ]));
    expect(xml).toContain("PayeeFinancialAccount");
  });
});
