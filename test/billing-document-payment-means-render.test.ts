import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { invoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { peppolUblBis3CreditnoteFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-creditnote";
import { ciiD22bEn16931Format } from "../utils/type-repository/document-formats/cii-d22b-en16931";
import { xrechnungUblCreditnoteFormat } from "../utils/type-repository/document-formats/xrechnung-ubl-creditnote";
import type { AnyDocumentFormat } from "../utils/type-repository/document-formats/types";
import { renderBillingDocument, type ParsedBillingDocument } from "../utils/document-renderer";

// The billing document layout is filled by an external render service, so the
// request it would receive is captured instead: the template and the data it is
// filled with. The payment means title comes from the payment means code, and the
// payee account name (BT-85) is shown on a line of its own.

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

const IBAN = "BE68539007547034";
const transfer = (overrides: Record<string, unknown> = {}) => ({
  paymentMethod: "credit_transfer",
  iban: IBAN,
  name: "Acme Treasury Account",
  ...overrides,
});

const invoice = (paymentMeans: unknown[]): Invoice =>
  invoiceSchema.parse({
    invoiceNumber: "INV-2026-001",
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    ...parties,
    paymentMeans,
    lines,
  });

const creditNote = (paymentMeans: unknown[]): CreditNote =>
  creditNoteSchema.parse({
    creditNoteNumber: "CN-2026-001",
    issueDate: "2026-04-01",
    invoiceReferences: [{ id: "INV-2026-001", issueDate: "2026-04-01" }],
    ...parties,
    paymentMeans,
    lines,
  });

const encode = (format: AnyDocumentFormat, document: Invoice | CreditNote) =>
  format.encode(document as any, format.supportedProcessIds[0], context);

const decode = (format: AnyDocumentFormat, xml: string) =>
  format.decode(xml, format.supportedProcessIds[0]) as ParsedBillingDocument;

async function renderRequest(parsed: ParsedBillingDocument, type: "invoice" | "creditNote") {
  let body: { html: string; data: { paymentMeans: Record<string, unknown>[] | null } } | undefined;
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

const renderedPaymentMeans = async (parsed: ParsedBillingDocument, type: "invoice" | "creditNote" = "invoice") =>
  (await renderRequest(parsed, type)).data.paymentMeans![0];

describe("billing document payee account name (BT-85)", () => {
  const roundTrips = [
    { title: "a UBL invoice", type: "invoice" as const, format: peppolUblBis3InvoiceFormat, document: invoice },
    { title: "a UBL credit note", type: "creditNote" as const, format: peppolUblBis3CreditnoteFormat, document: creditNote },
    { title: "a CII invoice", type: "invoice" as const, format: ciiD22bEn16931Format, document: invoice },
  ];

  for (const { title, type, format, document } of roundTrips) {
    it(`titles the payment means of ${title} by its code and shows the account name apart`, async () => {
      const parsed = decode(format, encode(format, document([transfer()])));
      const payment = await renderedPaymentMeans(parsed, type);

      expect(payment.paymentMethodName).toBe("Credit transfer");
      expect(payment.iban).toBe(IBAN);
      expect(payment.accountName).toBe("Acme Treasury Account");
    });
  }

  it("shows the payment account name of a received XRechnung credit note", async () => {
    // KoSIT test document: code 58 with PayeeFinancialAccount/cbc:Name "[Payment account name]".
    const xml = await Bun.file(join(import.meta.dir, "fixtures", "xrechnung-3.0.2", "ubl-cn-br-de-15-test.xml")).text();
    const payment = await renderedPaymentMeans(decode(xrechnungUblCreditnoteFormat, xml), "creditNote");

    expect(payment.paymentMethodName).toBe("SEPA credit transfer");
    expect(payment.iban).toBe("DE75512108001245126199");
    expect(payment.accountName).toBe("[Payment account name]");
  });

  it("falls back to a generic title for a code without a label and keeps the account name", async () => {
    const xml = encode(peppolUblBis3InvoiceFormat, invoice([transfer()])).replace(
      "<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>",
      '<cbc:PaymentMeansCode name="Direct debit via bank">49</cbc:PaymentMeansCode>'
    );
    expect(xml).toContain('name="Direct debit via bank">49<');
    const payment = await renderedPaymentMeans(decode(peppolUblBis3InvoiceFormat, xml));

    expect(payment.paymentMethodName).toBe("Payment");
    expect(payment.accountName).toBe("Acme Treasury Account");
  });

  it("leaves the account name out when the document carries no payee account, as its XML does", async () => {
    const document = invoice([
      { paymentMethod: "sepa_direct_debit", iban: "", name: "Direct debit via bank", mandate: { reference: "MANDATE-1" } },
    ]);
    const unparsed = await renderedPaymentMeans(document);
    const throughXml = await renderedPaymentMeans(decode(peppolUblBis3InvoiceFormat, encode(peppolUblBis3InvoiceFormat, document)));

    expect(unparsed.paymentMethodName).toBe("SEPA direct debit");
    expect(unparsed.accountName).toBeNull();
    expect(throughXml.accountName).toBeNull();
  });

  it("shows the name as the account name when it comes with a payee account, as its XML does", async () => {
    // The serializers write name as the payee account name (BT-85), whatever it says.
    const document = invoice([transfer({ name: "Credit Transfer" })]);
    const xml = encode(peppolUblBis3InvoiceFormat, document);
    expect(xml).toContain("<cbc:Name>Credit Transfer</cbc:Name>");
    const unparsed = await renderedPaymentMeans(document);
    const throughXml = await renderedPaymentMeans(decode(peppolUblBis3InvoiceFormat, xml));

    expect(unparsed.paymentMethodName).toBe("Credit transfer");
    expect(unparsed.accountName).toBe("Credit Transfer");
    expect(throughXml).toEqual(unparsed);
  });

  it("leaves the account name out without a name", async () => {
    const parsed = decode(peppolUblBis3InvoiceFormat, encode(peppolUblBis3InvoiceFormat, invoice([transfer({ name: null })])));
    const payment = await renderedPaymentMeans(parsed);

    expect(payment.paymentMethodName).toBe("Credit transfer");
    expect(payment.accountName).toBeNull();
  });

  it("gives the layout a line for the account name", async () => {
    const { html } = await renderRequest(invoice([transfer()]), "invoice");

    expect(html).toContain("{{#accountName}}");
    expect(html).toContain("Account name: {{accountName}}");
  });
});
