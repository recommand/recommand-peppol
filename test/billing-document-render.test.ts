import { afterEach, describe, expect, it } from "bun:test";
import { invoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-creditnote";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import { renderBillingDocument, type ParsedBillingDocument } from "../utils/document-renderer";

// The billing document layout is filled by an external render service, so the
// request it would receive is captured instead: the template and the data it is
// filled with. Documents go through their UBL XML first, as a stored document does.

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const context = {
  senderAddress: "0208:1234567894",
  recipientAddress: "0208:0123456749",
  isDocumentValidationEnforced: true,
};

const parties = {
  seller: { name: "Seller BV", street: "Street 1", street2: null, city: "Ghent", postalZone: "9000", country: "BE", vatNumber: "BE1234567894" },
  buyer: { name: "Buyer BV", street: "Street 2", street2: null, city: "Antwerp", postalZone: "2000", country: "BE", vatNumber: "BE0123456749" },
};

const lines = [
  {
    name: "Consulting",
    quantity: "1",
    unitCode: "C62",
    netPriceAmount: "100.00",
    vat: { category: "S", percentage: "21.00" },
  },
];

const invoice = (overrides: Record<string, unknown> = {}): Invoice =>
  invoiceSchema.parse({
    invoiceNumber: "INV-2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    ...parties,
    lines,
    ...overrides,
  });

const creditNote = (overrides: Record<string, unknown> = {}): CreditNote =>
  creditNoteSchema.parse({
    creditNoteNumber: "CN-2026-001",
    issueDate: "2026-04-01",
    invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-04-01" }],
    ...parties,
    lines,
    ...overrides,
  });

const throughXml = (format: AnyDocumentFormat, document: Invoice | CreditNote) =>
  format.decode(
    format.encode(document as any, format.supportedProcessIds[0], context),
    format.supportedProcessIds[0]
  ) as ParsedBillingDocument;

async function renderRequest(parsed: ParsedBillingDocument, type: "invoice" | "creditNote") {
  let body: { html: string; data: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response("<html></html>");
  }) as unknown as typeof fetch;
  await renderBillingDocument(parsed, { format: "html" }, {
    documentId: "doc_1",
    type,
    documentTypeTitle: type === "invoice" ? "Invoice" : "Credit Note",
  });
  return body!;
}

const cases = [
  { title: "an invoice", type: "invoice" as const, format: peppolUblBis3InvoiceFormat, document: invoice },
  { title: "a credit note", type: "creditNote" as const, format: peppolUblBis3CreditnoteFormat, document: creditNote },
];

describe("billing document purchase order reference (BT-13)", () => {
  for (const { title, type, format, document } of cases) {
    it(`passes the purchase order reference of ${title} to the layout`, async () => {
      const parsed = throughXml(format, document({ purchaseOrderReference: "4500012345" }));
      const { html, data } = await renderRequest(parsed, type);

      expect(data.purchaseOrderReference).toBe("4500012345");
      expect(html).toContain("{{#purchaseOrderReference}}");
      expect(html).toContain("Purchase order: {{purchaseOrderReference}}");
    });

    it(`leaves the purchase order reference out of ${title} without one`, async () => {
      const parsed = throughXml(format, document());
      const { data } = await renderRequest(parsed, type);

      expect(data.purchaseOrderReference).toBeNull();
    });
  }

  it("shows the NA that UBL requires when only a sales order reference is given", async () => {
    // cac:OrderReference needs a cbc:ID, so a sales order reference alone is written
    // with NA, which reads back like a purchase order reference the user gave as NA.
    const parsed = throughXml(peppolUblBis3InvoiceFormat, invoice({ salesOrderReference: "SO-123" }));
    const { data } = await renderRequest(parsed, "invoice");

    expect(data.purchaseOrderReference).toBe("NA");
  });
});
