import type { DocumentIncomingNotificationProps } from "@peppol/emails/document-incoming-notification";
import type { DocumentOutgoingNotificationProps } from "@peppol/emails/document-outgoing-notification";
import { getCompanyById } from "@peppol/data/companies";
import { extractDocumentAttachments, getDocumentTypeLabel } from "@peppol/data/email/send-email";
import { labels, transmittedDocuments } from "@peppol/db/schema";
import { getDocumentFilename, type ParsedDocument } from "@peppol/utils/document-filename";
import {
  extractDocumentDetails,
  UNNAMED_PARTY,
} from "@peppol/data/email/document-details";
import {
  isReportingDocumentType,
  type DocumentType,
} from "@peppol/utils/document-types";
import {
  isRenderableDocumentType,
  renderDocumentPdf,
} from "@peppol/utils/document-renderer";
import { resolveDocumentParsedWithAttachments, resolveDocumentXml } from "@peppol/data/offload/storage";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { db } from "@recommand/db";
import { and, eq } from "drizzle-orm";
import type { EventEnvelope } from "@core/lib/rules/types";

function getAppBaseUrl() {
  return (process.env.BASE_URL ?? "https://app.recommand.eu").replace(/\/$/, "");
}

function getDocumentTypeLabelSafe(type?: string | null) {
  if (!type) {
    return "Document";
  }

  return getDocumentTypeLabel(type as DocumentType);
}

export async function buildIncomingDocumentNotificationProps(
  event: EventEnvelope
): Promise<DocumentIncomingNotificationProps> {
  const [document] = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      parsed: transmittedDocuments.parsed,
    })
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.id, event.aggregateId))
    .limit(1);

  if (!document) {
    throw new Error(`Document not found for event ${event.aggregateId}`);
  }

  const company = await getCompanyById(document.companyId);
  if (!company) {
    throw new Error(`Company not found for document ${document.id}`);
  }

  const { documentNumber, amount, currency, senderName } =
    extractDocumentDetails(
      (document.parsed as ParsedDocument | null | undefined) ?? null,
      document.type
    );

  return {
    event,
    companyName: company.name,
    senderName: senderName ?? UNNAMED_PARTY,
    documentType: getDocumentTypeLabel(document.type),
    documentNumber,
    amount,
    currency,
    documentUrl: `${getAppBaseUrl()}/transmitted-documents/${document.id}`,
  };
}

export async function buildOutgoingDocumentNotificationProps(
  event: EventEnvelope
): Promise<DocumentOutgoingNotificationProps> {
  const [document] = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      parsed: transmittedDocuments.parsed,
    })
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.id, event.aggregateId))
    .limit(1);

  if (!document) {
    throw new Error(`Document not found for event ${event.aggregateId}`);
  }

  const company = await getCompanyById(document.companyId);
  if (!company) {
    throw new Error(`Company not found for document ${document.id}`);
  }

  const { documentNumber, amount, currency, receiverName } =
    extractDocumentDetails(
      (document.parsed as ParsedDocument | null | undefined) ?? null,
      document.type
    );

  return {
    companyName: company.name,
    recipientName: receiverName ?? UNNAMED_PARTY,
    documentType: getDocumentTypeLabel(document.type),
    documentNumber,
    amount,
    currency,
    documentUrl: `${getAppBaseUrl()}/transmitted-documents/${document.id}`,
    channel: isReportingDocumentType(document.type) ? "reporting" : "peppol",
  };
}

export async function buildDocumentLabelNotificationProps(event: EventEnvelope) {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as {
          companyId?: string;
          labelId?: string;
          labelExternalId?: string | null;
          docType?: string;
        })
      : undefined;

  const [document] = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      parsed: transmittedDocuments.parsed,
    })
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.id, event.aggregateId))
    .limit(1);

  const company = payload?.companyId
    ? await getCompanyById(payload.companyId)
    : document?.companyId
      ? await getCompanyById(document.companyId)
      : null;

  const [label] = payload?.labelId
    ? await db
        .select({
          name: labels.name,
          externalId: labels.externalId,
        })
        .from(labels)
        .where(and(eq(labels.id, payload.labelId), eq(labels.teamId, event.teamId)))
        .limit(1)
    : [];

  const documentNumber = document
    ? extractDocumentDetails(
        (document.parsed as ParsedDocument | null | undefined) ?? null,
        document.type
      ).documentNumber
    : undefined;

  return {
    companyName: company?.name ?? payload?.companyId ?? "Unknown",
    labelName: label?.name ?? payload?.labelExternalId ?? payload?.labelId ?? "Unknown",
    labelExternalId: label?.externalId ?? payload?.labelExternalId ?? null,
    documentType: getDocumentTypeLabelSafe(document?.type ?? payload?.docType),
    documentNumber,
    documentUrl: `${getAppBaseUrl()}/transmitted-documents/${event.aggregateId}`,
  };
}

export async function buildCompanyVerificationNotificationProps(event: EventEnvelope) {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as {
          companyId?: string;
        })
      : undefined;

  const company = payload?.companyId
    ? await getCompanyById(payload.companyId)
    : null;

  return {
    companyName: company?.name ?? payload?.companyId ?? "Unknown",
    companyUrl: payload?.companyId
      ? `${getAppBaseUrl()}/companies/${payload.companyId}`
      : null,
  };
}

export async function buildIncomingDocumentNotificationAttachmentParts(options: {
  transmittedDocumentId: string;
  companyId: string;
  companyName: string;
  type: DocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  includeAutoGeneratedPdf: boolean;
  includeDocumentJson: boolean;
}) {
  return buildDocumentNotificationAttachmentParts({
    ...options,
    direction: "incoming",
  });
}

export async function buildOutgoingDocumentNotificationAttachmentParts(options: {
  transmittedDocumentId: string;
  companyId: string;
  companyName: string;
  type: DocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  includeAutoGeneratedPdf: boolean;
  includeDocumentJson: boolean;
}) {
  return buildDocumentNotificationAttachmentParts({
    ...options,
    direction: "outgoing",
  });
}

async function buildDocumentNotificationAttachmentParts(options: {
  transmittedDocumentId: string;
  companyId: string;
  companyName: string;
  type: DocumentType;
  parsedDocument: ParsedDocument | null;
  xmlDocument: string | null;
  includeAutoGeneratedPdf: boolean;
  includeDocumentJson: boolean;
  direction: "incoming" | "outgoing";
}) {
  const embeddedAttachments = extractDocumentAttachments(options.parsedDocument);
  const filename = getDocumentFilename(options.type, options.parsedDocument);
  const xmlAttachment = options.xmlDocument
    ? {
        Content: Buffer.from(options.xmlDocument, "utf-8").toString("base64"),
        ContentID: null,
        ContentType: "application/xml",
        Name: filename + ".xml",
      }
    : null;

  let autoGeneratedPdfAttachment: {
    Content: string;
    ContentID: string | null;
    ContentType: string;
    Name: string;
  } | null = null;

  if (
    options.includeAutoGeneratedPdf &&
    options.parsedDocument &&
    isRenderableDocumentType(options.type)
  ) {
    try {
      const pdfBuffer = await renderDocumentPdf({
        id: options.transmittedDocumentId,
        type: options.type,
        parsed: options.parsedDocument,
      } as never);
      autoGeneratedPdfAttachment = {
        Content: Buffer.from(pdfBuffer).toString("base64"),
        ContentID: null,
        ContentType: "application/pdf",
        Name: "auto-generated.pdf",
      };
    } catch (error) {
      console.error(
        `Failed to generate auto-generated PDF for ${options.direction} notification:`,
        error
      );
      sendSystemAlert(
        "Document Notification Attachment Failed",
        `Failed to generate auto-generated PDF for ${options.direction} document ${options.transmittedDocumentId}.`,
        "error"
      );
    }
  }

  const documentJsonAttachment = options.includeDocumentJson
    ? {
        Content: Buffer.from(
          JSON.stringify(
            {
              id: options.transmittedDocumentId,
              companyId: options.companyId,
              companyName: options.companyName,
              direction: options.direction,
              type: options.type,
              parsed: options.parsedDocument,
            },
            null,
            2
          ),
          "utf-8"
        ).toString("base64"),
        ContentID: null,
        ContentType: "application/json",
        Name: "document.json",
      }
    : null;

  return {
    embeddedAttachments,
    xmlAttachment,
    autoGeneratedPdfAttachment,
    documentJsonAttachment,
  };
}

export async function buildPeppolDocumentEmailAttachments(
  event: EventEnvelope,
  attach: {
    embeddedAttachments?: boolean;
    xmlDocument?: boolean;
    autoGeneratedPdf?: boolean;
    documentJson?: boolean;
  } | undefined
) {
  const attachments: Array<{
    Content: string;
    ContentID: string | null;
    ContentType: string;
    Name: string;
  }> = [];

  if (!attach || event.aggregateType !== "peppol.document") {
    return attachments;
  }

  const [document] = await db
    .select({
      id: transmittedDocuments.id,
      teamId: transmittedDocuments.teamId,
      createdAt: transmittedDocuments.createdAt,
      xml: transmittedDocuments.xml,
      xmlLocation: transmittedDocuments.xmlLocation,
      parsed: transmittedDocuments.parsed,
      attachmentsLocation: transmittedDocuments.attachmentsLocation,
      s3KeyPrefix: transmittedDocuments.s3KeyPrefix,
      type: transmittedDocuments.type,
      companyId: transmittedDocuments.companyId,
      direction: transmittedDocuments.direction,
    })
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.id, event.aggregateId))
    .limit(1);

  if (!document) {
    return attachments;
  }

  const company = await getCompanyById(document.companyId);
  if (!company) {
    return attachments;
  }

  const parsedDocument =
    ((await resolveDocumentParsedWithAttachments(document)) as ParsedDocument | null | undefined) ?? null;
  const xmlDocument = await resolveDocumentXml(document);

  const attachmentParts = document.direction === "outgoing"
    ? await buildOutgoingDocumentNotificationAttachmentParts({
        transmittedDocumentId: document.id,
        companyId: document.companyId,
        companyName: company.name,
        type: document.type,
        parsedDocument,
        xmlDocument,
        includeAutoGeneratedPdf: Boolean(attach.autoGeneratedPdf),
        includeDocumentJson: Boolean(attach.documentJson),
      })
    : await buildIncomingDocumentNotificationAttachmentParts({
        transmittedDocumentId: document.id,
        companyId: document.companyId,
        companyName: company.name,
        type: document.type,
        parsedDocument,
        xmlDocument,
        includeAutoGeneratedPdf: Boolean(attach.autoGeneratedPdf),
        includeDocumentJson: Boolean(attach.documentJson),
      });

  if (attach.embeddedAttachments) {
    attachments.push(...attachmentParts.embeddedAttachments);
  }
  if (attach.xmlDocument && attachmentParts.xmlAttachment) {
    attachments.push(attachmentParts.xmlAttachment);
  }
  if (attach.autoGeneratedPdf && attachmentParts.autoGeneratedPdfAttachment) {
    attachments.push(attachmentParts.autoGeneratedPdfAttachment);
  }
  if (attach.documentJson && attachmentParts.documentJsonAttachment) {
    attachments.push(attachmentParts.documentJsonAttachment);
  }

  return attachments;
}
