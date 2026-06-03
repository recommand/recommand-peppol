import { UserFacingError } from "./util";

export type BillingDocumentType = "invoice" | "creditNote" | "selfBillingInvoice" | "selfBillingCreditNote";
export type TransactionDocumentType = "invoiceResponse" | "messageLevelResponse";
export type UnknownDocumentType = "unknown";
export type DocumentType = BillingDocumentType | TransactionDocumentType | UnknownDocumentType;
export type SupportedDocumentType = BillingDocumentType | "messageLevelResponse" | UnknownDocumentType;

export type DocumentTypeInfo = {
    type: BillingDocumentType | TransactionDocumentType;
    title: string;
    docTypeId: string;
    processId: string;
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

export const CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France CII Invoice CIUS",
    docTypeId: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::D22B",
    processId: "urn:peppol:france:billing:regulated"
};

export const FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "invoice",
    title: "France Factur-X",
    docTypeId: "urn:peppol:doctype:pdf+xml##urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:Factur-X:1.0::D22B",
    processId: "urn:peppol:france:billing:regulated"
};

export const CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO: DocumentTypeInfo = {
    type: "creditNote",
    title: "France CII Credit Note CIUS",
    docTypeId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    processId: CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId
};

export const DOCUMENT_TYPE_PRESETS: DocumentTypeInfo[] = [
    INVOICE_DOCUMENT_TYPE_INFO,
    CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    SI_UBL_INVOICE_DOCUMENT_TYPE_INFO,
    SI_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    INVOICE_RESPONSE_DOCUMENT_TYPE_INFO,
    MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
    CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
    FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
];

export const BILLING_DOCUMENT_TYPE_INFO: DocumentTypeInfo[] = [
    INVOICE_DOCUMENT_TYPE_INFO,
    CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
    SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
    CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
    CII_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
    FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
];

export function getDocumentTypeInfo(type: string): DocumentTypeInfo {
    const documentType = DOCUMENT_TYPE_PRESETS.find(dt => dt.type === type);
    if (!documentType) {
        throw new UserFacingError(`Document type ${type} not found`);
    }
    return documentType;
};
