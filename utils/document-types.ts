import { UserFacingError } from "./util";
import type { FranceCdarBusinessProcess } from "./parsing/france-cdar/schemas";

// The document types that carry a billing transaction. Every format we support (UBL,
// CII, Factur-X, and their French variants) serialises one of these, so the formats do
// not appear here: the document type decides what a document is, the doc type id
// decides how it is written.
export const BILLING_DOCUMENT_TYPES = [
    "invoice",
    "creditNote",
    "selfBillingInvoice",
    "selfBillingCreditNote",
] as const;

export type BillingDocumentType = (typeof BILLING_DOCUMENT_TYPES)[number];
export type TransactionDocumentType = "invoiceResponse" | "messageLevelResponse" | "frenchInvoicingCdar";
// Documents that are filed with a tax administration instead of being exchanged
// over Peppol. They have no XML representation and no Peppol recipient.
export const REPORTING_DOCUMENT_TYPES = [
    "frenchB2CSalesReport",
    "frenchB2CPaymentReport",
] as const;

export type ReportingDocumentType = (typeof REPORTING_DOCUMENT_TYPES)[number];
export type UnknownDocumentType = "unknown";
export type DocumentType = BillingDocumentType | TransactionDocumentType | ReportingDocumentType | UnknownDocumentType;
export type SupportedDocumentType = BillingDocumentType | "messageLevelResponse" | "frenchInvoicingCdar" | ReportingDocumentType | UnknownDocumentType;

export type DocumentTypeInfo = {
    type: BillingDocumentType | TransactionDocumentType | ReportingDocumentType;
    title: string;
    docTypeId: string;
    processId: string;
    ciiGuidelineIdOverride?: string;
}

export function getCustomizationId(documentTypeInfo: DocumentTypeInfo): string {
    const match = documentTypeInfo.docTypeId.match(/##(.+)::[^:]+$/);
    if (!match) {
        throw new Error(`Cannot derive customization ID from document type '${documentTypeInfo.docTypeId}'.`);
    }
    return match[1];
}

// French billing runs over two Peppol processes that share the same document type
// identifiers. The regulated process carries the flows inside the French e-invoicing
// perimeter (they are reported to the tax administration), the non-regulated process
// carries everything exchanged over the same network but outside that perimeter.
export const FRANCE_REGULATED_PROCESS_ID = "urn:peppol:france:billing:regulated";
export const FRANCE_NON_REGULATED_PROCESS_ID = "urn:peppol:france:billing:non-regulated";

export type FranceBillingBusinessProcess = "REGULATED" | "NON_REGULATED";

export function getFranceBillingProcessId(
    businessProcess: FranceBillingBusinessProcess
): string {
    return businessProcess === "REGULATED"
        ? FRANCE_REGULATED_PROCESS_ID
        : FRANCE_NON_REGULATED_PROCESS_ID;
}

function toNonRegulated(
    documentTypeInfo: DocumentTypeInfo,
    title: string
): DocumentTypeInfo {
    return {
        ...documentTypeInfo,
        title,
        processId: FRANCE_NON_REGULATED_PROCESS_ID,
    };
}

export const INVOICE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "Invoice",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
};

export const CREDIT_NOTE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {

    type: "creditNote",
    title: "Credit Note",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
};

export const FRANCE_UBL_INVOICE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France Peppol BIS Billing UBL Invoice",
    docTypeId: INVOICE_DOCUMENT_TYPE_INFO.docTypeId,
    processId: FRANCE_REGULATED_PROCESS_ID
};

export const FRANCE_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France Peppol BIS Billing UBL Credit Note",
    docTypeId: CREDIT_NOTE_DOCUMENT_TYPE_INFO.docTypeId,
    processId: FRANCE_REGULATED_PROCESS_ID
};

export const SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "selfBillingInvoice",
    title: "Self Billing Invoice",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0"
};

export const SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "selfBillingCreditNote",
    title: "Self Billing Credit Note",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0"
};

export const SI_UBL_INVOICE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "SI-UBL 2.0 Invoice",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
};

export const SI_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "SI-UBL 2.0 Credit Note",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
};

export const INVOICE_RESPONSE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoiceResponse",
    title: "Invoice Response",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:invoice_response:3::2.1",
    processId: "urn:fdc:peppol.eu:poacc:bis:invoice_response:3"
};

export const MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "messageLevelResponse",
    title: "Message Level Response",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:mlr:3::2.1",
    processId: "urn:fdc:peppol.eu:poacc:bis:mlr:3"
};

export const FRANCE_CDAR_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "frenchInvoicingCdar",
    title: "France Invoicing CDAR",
    docTypeId: "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100::CrossDomainAcknowledgementAndResponse##urn:peppol:france:billing:cdv:1.0::D22B",
    processId: FRANCE_REGULATED_PROCESS_ID
};

export const FRANCE_CDAR_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        FRANCE_CDAR_DOCUMENT_TYPE_INFO,
        "France Invoicing CDAR (Non-Regulated)"
    );

export function getFranceCdarProcessId(
    businessProcess: FranceCdarBusinessProcess
): string {
    // Only the regulated perimeter travels over the regulated process; every other
    // classification (non-regulated, B2C, international, out of scope) uses the
    // non-regulated one.
    return getFranceBillingProcessId(
        businessProcess === "REGULATED" ? "REGULATED" : "NON_REGULATED"
    );
}

// French B2C reporting is filed with the tax administration through our reporting
// partner, not exchanged over Peppol. The identifiers below are internal markers so
// the transmitted document row stays queryable; they are deliberately kept out of
// DOCUMENT_TYPE_PRESETS (they must never be offered as an SMP receiving capability)
// and out of DOCUMENT_XML_HANDLERS (there is no XML representation).
//
// Sales and payment reports are distinct filings: a sales report covers the daily
// transaction totals, a payment report the amounts received for services under
// cash-basis VAT. They are separate document types so they can be filtered, billed
// and matched by rules independently.
export type ReportingDocumentTypeInfo = DocumentTypeInfo & {
    type: ReportingDocumentType;
};

export const FRANCE_B2C_SALES_REPORT_DOCUMENT_TYPE_INFO: ReportingDocumentTypeInfo = {
    type: "frenchB2CSalesReport",
    title: "French B2C Sales Report",
    docTypeId: "urn:recommand:reporting:france:b2c:sales:1.0",
    processId: "urn:recommand:reporting:france:b2c"
};

export const FRANCE_B2C_PAYMENT_REPORT_DOCUMENT_TYPE_INFO: ReportingDocumentTypeInfo = {
    type: "frenchB2CPaymentReport",
    title: "French B2C Payment Report",
    docTypeId: "urn:recommand:reporting:france:b2c:payments:1.0",
    processId: "urn:recommand:reporting:france:b2c"
};

export function isReportingDocumentType(type: string): type is ReportingDocumentType {
    return (REPORTING_DOCUMENT_TYPES as readonly string[]).includes(type);
}

export function isBillingDocumentType(type: string): type is BillingDocumentType {
    return (BILLING_DOCUMENT_TYPES as readonly string[]).includes(type);
}

export const CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France CII Invoice CIUS",
    docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::D22B",
    processId: FRANCE_REGULATED_PROCESS_ID
};

export const UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France UBL Invoice CIUS",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
    processId: FRANCE_REGULATED_PROCESS_ID
};

export const UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France UBL Credit Note CIUS",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1",
    processId: UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.processId
};

export const UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France UBL Invoice Extended",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::2.1",
    processId: UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.processId
};

export const UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France UBL Credit Note Extended",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::2.1",
    processId: UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.processId
};

export const CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France CII Invoice Extended",
    docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0::D22B",
    processId: UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.processId
};

export const CII_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France CII Credit Note Extended",
    docTypeId: CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.docTypeId,
    processId: CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO.processId
};

export const CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "EN 16931 CII Invoice D22B",
    docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017::D22B",
    processId: INVOICE_DOCUMENT_TYPE_INFO.processId
};

export const CII_EN16931_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "EN 16931 CII Credit Note D22B",
    docTypeId: CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    processId: CREDIT_NOTE_DOCUMENT_TYPE_INFO.processId
};

export const FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France Factur-X Invoice",
    docTypeId: "urn:peppol:doctype:pdf+xml##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:Factur-X:1.0::D22B",
    processId: FRANCE_REGULATED_PROCESS_ID,
    ciiGuidelineIdOverride: "urn:cen.eu:en16931:2017"
};

export const FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France Factur-X Credit Note",
    docTypeId: FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    processId: FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId,
    ciiGuidelineIdOverride: FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.ciiGuidelineIdOverride
};

export const CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France CII Credit Note CIUS",
    docTypeId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    processId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId
};

// CII and Factur-X carry invoices and credit notes under a single document type
// identifier and process, so a participant registers one SMP capability for both. The
// presets below offer that capability once, under a combined title; the per-type infos
// above stay separate because the serializers and parsers differ.
function forInvoiceAndCreditNote(
    documentTypeInfo: DocumentTypeInfo,
    title: string
): DocumentTypeInfo {
    return { ...documentTypeInfo, title };
}

const CII_EN16931_D22B_PRESET = forInvoiceAndCreditNote(
    CII_EN16931_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    "EN 16931 CII Invoice + Credit Note D22B"
);

const CII_FRANCE_CIUS_PRESET = forInvoiceAndCreditNote(
    CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    "France CII Invoice + Credit Note CIUS"
);

const CII_FRANCE_EXTENDED_PRESET = forInvoiceAndCreditNote(
    CII_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
    "France CII Invoice + Credit Note Extended"
);

const FACTURX_FRANCE_PRESET = forInvoiceAndCreditNote(
    FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    "France Factur-X Invoice + Credit Note"
);

// Non-regulated counterparts of the French billing document types. They carry the same
// document type identifiers and are converted by the same handlers; only the Peppol
// process differs, so a participant has to advertise them separately in its SMP.
export const FRANCE_UBL_INVOICE_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        FRANCE_UBL_INVOICE_DOCUMENT_TYPE_INFO,
        "France Peppol BIS Billing UBL Invoice (Non-Regulated)"
    );

export const FRANCE_UBL_CREDIT_NOTE_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        FRANCE_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
        "France Peppol BIS Billing UBL Credit Note (Non-Regulated)"
    );

export const UBL_FRANCE_INVOICE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
        "France UBL Invoice CIUS (Non-Regulated)"
    );

export const UBL_FRANCE_CREDIT_NOTE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO,
        "France UBL Credit Note CIUS (Non-Regulated)"
    );

export const UBL_FRANCE_INVOICE_EXTENDED_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
        "France UBL Invoice Extended (Non-Regulated)"
    );

export const UBL_FRANCE_CREDIT_NOTE_EXTENDED_NON_REGULATED_DOCUMENT_TYPE_INFO: DocumentTypeInfo =
    toNonRegulated(
        UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
        "France UBL Credit Note Extended (Non-Regulated)"
    );

export const CII_FRANCE_CIUS_NON_REGULATED_PRESET: DocumentTypeInfo =
    toNonRegulated(
        CII_FRANCE_CIUS_PRESET,
        "France CII Invoice + Credit Note CIUS (Non-Regulated)"
    );

export const CII_FRANCE_EXTENDED_NON_REGULATED_PRESET: DocumentTypeInfo =
    toNonRegulated(
        CII_FRANCE_EXTENDED_PRESET,
        "France CII Invoice + Credit Note Extended (Non-Regulated)"
    );

export const FACTURX_FRANCE_NON_REGULATED_PRESET: DocumentTypeInfo =
    toNonRegulated(
        FACTURX_FRANCE_PRESET,
        "France Factur-X Invoice + Credit Note (Non-Regulated)"
    );

export const FRANCE_NON_REGULATED_DOCUMENT_TYPE_PRESETS: DocumentTypeInfo[] = [
    FRANCE_UBL_INVOICE_NON_REGULATED_DOCUMENT_TYPE_INFO,
    FRANCE_UBL_CREDIT_NOTE_NON_REGULATED_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_INVOICE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_CREDIT_NOTE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_INVOICE_EXTENDED_NON_REGULATED_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_CREDIT_NOTE_EXTENDED_NON_REGULATED_DOCUMENT_TYPE_INFO,
    CII_FRANCE_CIUS_NON_REGULATED_PRESET,
    CII_FRANCE_EXTENDED_NON_REGULATED_PRESET,
    FACTURX_FRANCE_NON_REGULATED_PRESET,
    FRANCE_CDAR_NON_REGULATED_DOCUMENT_TYPE_INFO,
];

export const DOCUMENT_TYPE_PRESETS: DocumentTypeInfo[] = [
    INVOICE_DOCUMENT_TYPE_INFO,
    CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    FRANCE_UBL_INVOICE_DOCUMENT_TYPE_INFO,
    FRANCE_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    SI_UBL_INVOICE_DOCUMENT_TYPE_INFO,
    SI_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    INVOICE_RESPONSE_DOCUMENT_TYPE_INFO,
    MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
    CII_EN16931_D22B_PRESET,
    CII_FRANCE_CIUS_PRESET,
    UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_CREDIT_NOTE_CIUS_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_INVOICE_EXTENDED_DOCUMENT_TYPE_INFO,
    UBL_FRANCE_CREDIT_NOTE_EXTENDED_DOCUMENT_TYPE_INFO,
    CII_FRANCE_EXTENDED_PRESET,
    FACTURX_FRANCE_PRESET,
    FRANCE_CDAR_DOCUMENT_TYPE_INFO,
    ...FRANCE_NON_REGULATED_DOCUMENT_TYPE_PRESETS,
];

export function getDocumentTypeInfo(type: string): DocumentTypeInfo {
    const documentType = DOCUMENT_TYPE_PRESETS.find(dt => dt.type === type);
    if (!documentType) {
        throw new UserFacingError(`Document type ${type} not found`);
    }
    return documentType;
};
