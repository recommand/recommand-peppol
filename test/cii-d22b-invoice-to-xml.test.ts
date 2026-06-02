import { describe, expect, it } from "bun:test";
import type { Invoice } from "../utils/parsing/invoice/schemas";
import { invoiceToCII } from "../utils/parsing/invoice/cii-d22b/to-xml";
import { validateXml } from "./utils/utils";

describe("invoiceToCII", () => {
  it("generates valid CII D22B XML", async () => {
    const invoice: Invoice = {
      invoiceNumber: "CII-001",
      issueDate: "2025-01-01",
      dueDate: "2025-01-31",
      currency: "EUR",
      buyerReference: "BUYER-REF",
      seller: {
        name: "Seller SAS",
        street: "1 Rue Seller",
        city: "Paris",
        postalZone: "75001",
        country: "FR",
        vatNumber: "FR40303265045",
        street2: null,
      },
      buyer: {
        name: "Buyer SAS",
        street: "2 Rue Buyer",
        city: "Lyon",
        postalZone: "69001",
        country: "FR",
        vatNumber: "FR23341815675",
        street2: null,
      },
      lines: [
        {
          name: "Service",
          quantity: "1",
          unitCode: "C62",
          netPriceAmount: "100.00",
          netAmount: null,
          vat: { category: "S", percentage: "20.00" },
        },
      ],
    };

    const xml = invoiceToCII({
      invoice,
      senderAddress: "0009:30326504500018",
      recipientAddress: "0009:34181567500010",
      isDocumentValidationEnforced: false,
    });

    expect(xml).toContain("CrossIndustryInvoice");
    // Save xml to file
    Bun.write("cii-d22b-invoice-to-xml.xml", xml);
    await validateXml(xml, "CII D22B invoice");
  });
});
