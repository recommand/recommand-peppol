import type { Company } from "@peppol/data/companies";
import { sendSystemAlert } from "../system-notifications/telegram";
import { XMLParser } from "fast-xml-parser";
import {
  FRANCE_CDAR_DOCUMENT_TYPE_INFO,
  MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
  type SupportedDocumentType,
} from "../document-types";
import { getDocumentXmlHandlersByDocTypeId } from "./document-handlers";
import { getTextContent } from "./xml-helpers";

function getCiiStandardVersion(parsedCii: any): string {
    for (const [key, value] of Object.entries(parsedCii)) {
        if (!key.startsWith("@_")) continue;
        const versionMatch = getTextContent(value).match(/CrossIndustryInvoice:(\d+)$/);
        if (versionMatch) {
            return versionMatch[1];
        }
    }
    return "100";
}

function getCiiSyntaxVersion(guidelineId: string): string {
    const versionMatch = guidelineId.match(/::(D\d{2}[AB])$/);
    if (versionMatch) {
        return versionMatch[1];
    }
    if (guidelineId.includes("urn:peppol:france:billing:cius:")) {
        return "D22B";
    }
    return "D22B";
}

function getSupportedDocTypeId(candidate: string): string | null {
    return getDocumentXmlHandlersByDocTypeId(candidate).length > 0 ? candidate : null;
}

function getCiiDocumentType(xml: string): SupportedDocumentType {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: true,
    });
    const parsed = parser.parse(xml);
    const typeCode = getTextContent(parsed.CrossIndustryInvoice?.ExchangedDocument?.TypeCode);
    if (typeCode === "381") {
        return "creditNote";
    }
    if (typeCode === "380") {
        return "invoice";
    }
    return "unknown";
}

export function parseDocument(docTypeId: string, xml: string, company: Company, senderId: string) {
    let parsedDocument = null;
    let type: SupportedDocumentType = "unknown";
    let probableType: SupportedDocumentType = "unknown";
    const handlers = getDocumentXmlHandlersByDocTypeId(docTypeId);
    const ciiType = docTypeId.includes("CrossIndustryInvoice") ? getCiiDocumentType(xml) : "unknown";
    const handler =
        handlers.find((candidate) => ciiType !== "unknown" && candidate.type === ciiType) ??
        handlers[0];

    if (handler) {
        probableType = handler.type;
        try {
            parsedDocument = handler.fromXml(xml);
            type = probableType;
        } catch (error) {
            console.error(`Failed to parse ${handler.title} XML:`, error);
            sendSystemAlert(
                "Document Parsing Error",
                `Failed to parse ${handler.title} XML\n\n` +
                `Company: ${company.name}\n` +
                `Sender: ${senderId}\n` +
                `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                "error"
            );
        }
    }

    return { parsedDocument, type, probableType };
}

export function detectDoctypeId(xml: string): string | null {
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            removeNSPrefix: true,
        });
        const parsed = parser.parse(xml);

        const defaultCustomizationId = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

        // If the document tag is a CreditNote, return the credit note or self billing credit note doctype id, depending on the customization id
        if (parsed.CreditNote) {
            // Get the customization id from the credit note
            const customizationId = parsed.CreditNote["CustomizationID"] || defaultCustomizationId;
            return getSupportedDocTypeId(`urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##${customizationId}::2.1`); // https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/ "A UBL invoice should not include the UBLVersionID or it should be 2.1"
        }

        // If the document tag is an Invoice, return the invoice or self billing invoice doctype id, depending on the customization id
        if (parsed.Invoice) {
            // Get the customization id from the invoice
            const customizationId = parsed.Invoice["CustomizationID"] || defaultCustomizationId;
            return getSupportedDocTypeId(`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##${customizationId}::2.1`); // https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/ "A UBL invoice should not include the UBLVersionID or it should be 2.1"
        }

        // If the document tag is a Message Level Response, return the message level response doctype id
        if (parsed.ApplicationResponse) {
            return getSupportedDocTypeId(MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO.docTypeId);
        }

        const cdar =
            parsed.CrossDomainAcknowledgementAndResponse ??
            parsed.StandardBusinessDocument?.CrossDomainAcknowledgementAndResponse;
        if (cdar) {
            const guidelineId = getTextContent(
                cdar.ExchangedDocumentContext
                    ?.GuidelineSpecifiedDocumentContextParameter?.ID
            );
            if (guidelineId === "urn.cpro.gouv.fr:1p0:CDV:invoice") {
                return getSupportedDocTypeId(
                    FRANCE_CDAR_DOCUMENT_TYPE_INFO.docTypeId
                );
            }
            return null;
        }

        if (parsed.CrossIndustryInvoice) {
            const standardVersion = getCiiStandardVersion(parsed.CrossIndustryInvoice);
            const guidelineId = getTextContent(parsed.CrossIndustryInvoice.ExchangedDocumentContext?.GuidelineSpecifiedDocumentContextParameter?.ID);
            const syntaxVersion = getCiiSyntaxVersion(guidelineId);
            if (guidelineId) {
                return getSupportedDocTypeId(`urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:${standardVersion}::CrossIndustryInvoice##${guidelineId}::${syntaxVersion}`);
            }
            return getSupportedDocTypeId(`urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:${standardVersion}::CrossIndustryInvoice##urn:cen.eu:en16931:2017::${syntaxVersion}`);
        }

        return null;
    } catch (error) {
        console.error("Failed to detect doctype id:", error);
        return null;
    }
}
