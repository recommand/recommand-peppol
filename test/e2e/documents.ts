/**
 * Document fixtures for the send-document end-to-end suite.
 *
 * These are written from scratch (not imported from the app) so a change in the
 * application schemas shows up as a failing test instead of silently changing
 * what we send.
 */

const RUN = Date.now().toString(36).toUpperCase();
let counter = 0;

function nextRef(prefix: string): string {
  counter += 1;
  return `${prefix}-${RUN}-${counter}`;
}

const SELLER = {
  name: "Recommand E2E Seller",
  street: "Teststraat 1",
  city: "Brussels",
  postalZone: "1000",
  country: "BE",
  vatNumber: "BE1234567894",
};

const BUYER = {
  name: "Recommand E2E Buyer",
  street: "Teststraat 2",
  city: "Antwerp",
  postalZone: "2000",
  country: "BE",
  vatNumber: "BE0598726857",
};

const LINES = [
  {
    name: "E2E test line",
    description: "End-to-end test line, do not process",
    quantity: "2",
    unitCode: "C62",
    netPriceAmount: "50.00",
    vat: { category: "S", percentage: "21.00" },
  },
];

const PAYMENT_MEANS = [
  {
    name: "Test bank",
    paymentMethod: "credit_transfer",
    reference: "E2E-PAYMENT",
    iban: "BE68539007547034",
  },
];

export function invoiceDocument(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: nextRef("E2E-INV"),
    issueDate: "2026-01-15",
    dueDate: "2026-02-15",
    currency: "EUR",
    note: "End-to-end test document, do not process.",
    buyerReference: "E2E-BUYER-REF",
    seller: { ...SELLER },
    buyer: { ...BUYER },
    paymentMeans: PAYMENT_MEANS,
    paymentTerms: { note: "Net 30" },
    lines: LINES,
    ...overrides,
  };
}

/** A second line at another VAT rate, so the totals have to group by rate. */
const REDUCED_RATE_LINE = {
  name: "E2E reduced rate line",
  description: "End-to-end test line, do not process",
  quantity: "1",
  unitCode: "C62",
  netPriceAmount: "30.00",
  vat: { category: "S", percentage: "6.00" },
};

export function multiVatInvoiceDocument(overrides: Record<string, unknown> = {}) {
  return invoiceDocument({ lines: [...LINES, REDUCED_RATE_LINE], ...overrides });
}

export function creditNoteDocument(overrides: Record<string, unknown> = {}) {
  return {
    creditNoteNumber: nextRef("E2E-CN"),
    issueDate: "2026-01-15",
    currency: "EUR",
    note: "End-to-end test document, do not process.",
    buyerReference: "E2E-BUYER-REF",
    invoiceReferences: [{ id: "E2E-CREDITED-INVOICE", issueDate: "2026-01-01" }],
    seller: { ...SELLER },
    buyer: { ...BUYER },
    paymentMeans: PAYMENT_MEANS,
    lines: LINES,
    ...overrides,
  };
}

export function selfBillingInvoiceDocument(overrides: Record<string, unknown> = {}) {
  return invoiceDocument({ invoiceNumber: nextRef("E2E-SBINV"), ...overrides });
}

export function selfBillingCreditNoteDocument(
  overrides: Record<string, unknown> = {}
) {
  return creditNoteDocument({ creditNoteNumber: nextRef("E2E-SBCN"), ...overrides });
}

export function messageLevelResponseDocument(
  overrides: Record<string, unknown> = {}
) {
  return {
    envelopeId: crypto.randomUUID(),
    responseCode: "AP",
    ...overrides,
  };
}

/**
 * A minimal, valid PEPPOL BIS Billing 3.0 UBL invoice. Element order follows
 * the UBL XSD sequence, which the validator enforces.
 */
export function invoiceXmlDocument(options: { buyerReference?: string | null } = {}) {
  const id = nextRef("E2E-XML");
  const buyerReference =
    options.buyerReference === null
      ? ""
      : `  <cbc:BuyerReference>${options.buyerReference ?? "E2E-BUYER-REF"}</cbc:BuyerReference>\n`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cbc:DueDate>2026-02-15</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
${buyerReference}  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0208">1234567894</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>Recommand E2E Seller</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Teststraat 1</cbc:StreetName>
        <cbc:CityName>Brussels</cbc:CityName>
        <cbc:PostalZone>1000</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>BE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>BE1234567894</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Recommand E2E Seller</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0208">0598726857</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>Recommand E2E Buyer</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Teststraat 2</cbc:StreetName>
        <cbc:CityName>Antwerp</cbc:CityName>
        <cbc:PostalZone>2000</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>BE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>BE0598726857</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Recommand E2E Buyer</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">21.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">21.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>21</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">121.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>E2E test line</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>21</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">50.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
}

/** Same document without a buyer reference, which PEPPOL-EN16931-R003 rejects. */
export function invalidInvoiceXmlDocument() {
  return invoiceXmlDocument({ buyerReference: null });
}

/** Doctype and process identifiers the API is expected to store. */
export const DOC_TYPE_ID = {
  invoice:
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  creditNote:
    "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  selfBillingInvoice:
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  selfBillingCreditNote:
    "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
  messageLevelResponse:
    "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:mlr:3::2.1",
  ciiInvoice:
    "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017::D22B",
} as const;

export const PROCESS_ID = {
  billing: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  selfBilling: "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0",
  messageLevelResponse: "urn:fdc:peppol.eu:poacc:bis:mlr:3",
} as const;

/** Used to prove an explicitly provided processId wins over detection. */
export const CUSTOM_PROCESS_ID = "urn:www.cenbii.eu:profile:bii05:ver2.0";

/** Well formed, but not a doctype the API knows how to parse. */
export const UNKNOWN_DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Order-2::Order##urn:fdc:peppol.eu:poacc:trns:order:3::2.1";

export type DocumentVariant = {
  /** Name used in the test title. */
  key: string;
  documentType: string;
  document: () => unknown;
  doctypeId?: string;
  processId?: string;
  /** Only billing documents may be sent with a null recipient. */
  isBillingType: boolean;
  /** PDF generation is rejected for message level responses and raw XML. */
  supportsPdf: boolean;
  /** What the stored document is expected to look like. */
  storedDocTypeId: string;
  storedProcessId: string;
  storedType: string;
};

export const DOCUMENT_VARIANTS: DocumentVariant[] = [
  {
    key: "invoice",
    documentType: "invoice",
    document: () => invoiceDocument(),
    isBillingType: true,
    supportsPdf: true,
    storedDocTypeId: DOC_TYPE_ID.invoice,
    storedProcessId: PROCESS_ID.billing,
    storedType: "invoice",
  },
  {
    key: "creditNote",
    documentType: "creditNote",
    document: () => creditNoteDocument(),
    isBillingType: true,
    supportsPdf: true,
    storedDocTypeId: DOC_TYPE_ID.creditNote,
    storedProcessId: PROCESS_ID.billing,
    storedType: "creditNote",
  },
  {
    key: "selfBillingInvoice",
    documentType: "selfBillingInvoice",
    document: () => selfBillingInvoiceDocument(),
    isBillingType: true,
    supportsPdf: true,
    storedDocTypeId: DOC_TYPE_ID.selfBillingInvoice,
    storedProcessId: PROCESS_ID.selfBilling,
    storedType: "selfBillingInvoice",
  },
  {
    key: "selfBillingCreditNote",
    documentType: "selfBillingCreditNote",
    document: () => selfBillingCreditNoteDocument(),
    isBillingType: true,
    supportsPdf: true,
    storedDocTypeId: DOC_TYPE_ID.selfBillingCreditNote,
    storedProcessId: PROCESS_ID.selfBilling,
    storedType: "selfBillingCreditNote",
  },
  {
    key: "messageLevelResponse",
    documentType: "messageLevelResponse",
    document: () => messageLevelResponseDocument(),
    isBillingType: false,
    supportsPdf: false,
    storedDocTypeId: DOC_TYPE_ID.messageLevelResponse,
    storedProcessId: PROCESS_ID.messageLevelResponse,
    storedType: "messageLevelResponse",
  },
  {
    key: "xml",
    documentType: "xml",
    document: () => invoiceXmlDocument(),
    isBillingType: false,
    supportsPdf: false,
    storedDocTypeId: DOC_TYPE_ID.invoice,
    storedProcessId: PROCESS_ID.billing,
    storedType: "invoice",
  },
  {
    key: "xml+doctypeId",
    documentType: "xml",
    document: () => invoiceXmlDocument(),
    doctypeId: DOC_TYPE_ID.invoice,
    isBillingType: false,
    supportsPdf: false,
    storedDocTypeId: DOC_TYPE_ID.invoice,
    storedProcessId: PROCESS_ID.billing,
    storedType: "invoice",
  },
  {
    key: "xml+processId",
    documentType: "xml",
    document: () => invoiceXmlDocument(),
    processId: CUSTOM_PROCESS_ID,
    isBillingType: false,
    supportsPdf: false,
    storedDocTypeId: DOC_TYPE_ID.invoice,
    storedProcessId: CUSTOM_PROCESS_ID,
    storedType: "invoice",
  },
  {
    key: "xml+doctypeId+processId",
    documentType: "xml",
    document: () => invoiceXmlDocument(),
    doctypeId: DOC_TYPE_ID.invoice,
    processId: CUSTOM_PROCESS_ID,
    isBillingType: false,
    supportsPdf: false,
    storedDocTypeId: DOC_TYPE_ID.invoice,
    storedProcessId: CUSTOM_PROCESS_ID,
    storedType: "invoice",
  },
];
