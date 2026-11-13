import { z } from "zod";
import "zod-openapi/extend";
import type { Team } from "@core/data/teams";
import { McpToolError, registerTool } from "@core/lib/mcp/tools";
import { transmittedDocumentFilters } from "@peppol/api/documents/shared";
import { withDocumentDeliveries } from "@peppol/data/deliveries";
import { withFrenchReportingStatus } from "@peppol/data/fr-reporting-submissions";
import { resolveDocumentParsedWithAttachments } from "@peppol/data/offload/storage";
import { getTransmittedDocument, getTransmittedDocuments } from "@peppol/data/transmitted-documents";
import { checkPeppolEntitlementForTeamId, PEPPOL_ENTITLEMENTS } from "@peppol/lib/entitlements";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";

/** As the document routes do: a team without document access keeps receiving, but can't read what it has. */
const requireDocumentAccess = async (team: Team) => {
  const entitlement = await checkPeppolEntitlementForTeamId(team.id, PEPPOL_ENTITLEMENTS.DOCUMENT_ACCESS);
  if (!entitlement.allowed) {
    throw new McpToolError(entitlement.message ?? "This team cannot access its documents", "no_document_access");
  }
};

type SummarizedDocument = {
  companyId: string;
  createdAt: Date | string;
  deliveryStatus?: string | null;
  direction: string;
  id: string;
  parsed: unknown;
  readAt: Date | string | null;
  receiverId: string | null;
  senderId: string;
  type: string;
};

/** The currency billing documents carry; the email details only hold a placeholder for it. */
const currencyOf = (parsed: unknown) =>
  parsed && typeof parsed === "object" && "currency" in parsed && typeof parsed.currency === "string" ? parsed.currency : null;

/** What a model needs to tell documents apart: who, what, how much, and where it stands. */
const summarize = (document: SummarizedDocument) => {
  const documentType = document.parsed ? getDocumentType(document.type) : undefined;
  const parsed = document.parsed as never;
  const details = documentType?.email?.extractDocumentDetails(parsed);
  const counterparties = documentType?.extractCounterparties(parsed);

  return {
    amount: details?.amount ?? null,
    companyId: document.companyId,
    createdAt: document.createdAt,
    currency: currencyOf(document.parsed),
    deliveryStatus: document.deliveryStatus ?? null,
    direction: document.direction,
    documentNumber: documentType?.extractDocumentNumber(parsed) ?? null,
    id: document.id,
    readAt: document.readAt,
    receiverId: document.receiverId,
    receiverName: counterparties?.receiverName ?? null,
    senderId: document.senderId,
    senderName: counterparties?.senderName ?? null,
    type: document.type,
  };
};

/** Attachments' contents are left out: they're base64 and of no use to the model as text. */
const withoutAttachmentContents = (parsed: unknown) => {
  if (!parsed || typeof parsed !== "object" || !("attachments" in parsed) || !Array.isArray(parsed.attachments)) {
    return parsed;
  }

  return {
    ...parsed,
    attachments: parsed.attachments.map(({ embeddedDocument, ...attachment }: Record<string, unknown>) => ({
      ...attachment,
      hasContents: !!embeddedDocument,
    })),
  };
};

/** A long document's lines, a page at a time, so it can be read however many lines it has. */
const withLinePage = (parsed: unknown, { limit, page }: { limit: number; page: number }) => {
  if (!parsed || typeof parsed !== "object" || !("lines" in parsed) || !Array.isArray(parsed.lines)) {
    return { linePagination: null, parsed };
  }

  const total = parsed.lines.length;

  return {
    linePagination: { limit, page, total, totalPages: Math.ceil(total / limit) },
    parsed: { ...parsed, lines: parsed.lines.slice((page - 1) * limit, page * limit) },
  };
};

registerTool({
  annotations: { openWorldHint: false, readOnlyHint: true },
  description:
    "Find documents the team's companies sent or received: invoices, credit notes and other Peppol documents. Filter by direction, type, company, date, delivery status or unread ones (the inbox), or search by number, name or Peppol ID. Returns a summary per document; use get_document for one document's full contents and delivery details.",
  handler: async ({ team }, { companyId, deliveryStatus, direction, from, limit, page, search, to, type, unreadOnly }) => {
    await requireDocumentAccess(team);
    // Only received documents are ever marked as read, so a sent one would always count as unread
    if (unreadOnly && direction === "outgoing") {
      throw new McpToolError("Only received documents can be unread: leave `direction` out, or set it to `incoming`.", "invalid_input");
    }

    const { documents, total } = await getTransmittedDocuments(team.id, {
      companyId: companyId ? [companyId] : undefined,
      deliveryStatus,
      direction: unreadOnly ? "incoming" : direction,
      excludeAttachments: true,
      from,
      isUnread: unreadOnly || undefined,
      limit,
      page,
      search,
      to,
      type,
    });

    return {
      documents: (await withDocumentDeliveries(documents)).map(summarize),
      pagination: { limit, page, total, totalPages: Math.ceil(total / limit) },
    };
  },
  input: z.object({
    companyId: z.string().optional().openapi({
      description: "Only documents of this company, as list_companies lists it.",
    }),
    deliveryStatus: transmittedDocumentFilters.shape.deliveryStatus.openapi({
      description: "Only outgoing documents whose delivery is `delivered`, `failed` or still `pending`.",
    }),
    direction: transmittedDocumentFilters.shape.direction.openapi({
      description: "Only received (`incoming`) or sent (`outgoing`) documents.",
    }),
    from: transmittedDocumentFilters.shape.from.openapi({
      description: "Only documents sent or received from this moment on, in ISO 8601.",
    }),
    limit: z.number().int().min(1).max(50).default(20).openapi({
      description: "How many documents per page, at most 50.",
    }),
    page: z.number().int().min(1).default(1).openapi({
      description: "The page to return, from 1.",
    }),
    search: transmittedDocumentFilters.shape.search.openapi({
      description: "Words to look for in the document number, the sender's or receiver's name or Peppol ID.",
    }),
    to: transmittedDocumentFilters.shape.to.openapi({
      description: "Only documents sent or received before this moment, in ISO 8601.",
    }),
    type: transmittedDocumentFilters.shape.type.openapi({
      description: "Only documents of this type.",
    }),
    unreadOnly: z.boolean().optional().openapi({
      description: "Only received documents not marked as read yet: the inbox.",
    }),
  }),
  name: "search_documents",
  operations: ["getDocuments"],
  title: "Search documents",
});

registerTool({
  annotations: { openWorldHint: false, readOnlyHint: true },
  description:
    "Get one document by ID: its contents (lines, totals, parties, payment details), and for a sent document whether it was delivered, and why not if a delivery failed. A long document's lines come a page at a time: `linePagination` says how many there are.",
  handler: async ({ team }, { documentId, limit, page }) => {
    await requireDocumentAccess(team);
    const document = await getTransmittedDocument(team.id, documentId);
    if (!document) {
      throw new McpToolError(`There's no document ${documentId} in this team.`, "not_found");
    }

    const [withStatus] = await withDocumentDeliveries(await withFrenchReportingStatus([document]));
    const { attachmentsLocation, deliveries, labels, parsed, reporting, s3KeyPrefix, validation } = withStatus!;
    // Attachments moved to storage are left out of the stored contents, as the documents API reads them back
    const withAttachments = await resolveDocumentParsedWithAttachments({ attachmentsLocation, parsed, s3KeyPrefix });
    const linePage = withLinePage(withoutAttachmentContents(withAttachments), { limit, page });

    return {
      ...summarize(withStatus!),
      deliveries,
      labels: (labels ?? []).map(({ id, name }) => ({ id, name })),
      linePagination: linePage.linePagination,
      parsed: linePage.parsed,
      reporting,
      validation,
    };
  },
  input: z.object({
    documentId: z.string().openapi({
      description: "The document's ID, as search_documents returns it.",
    }),
    limit: z.number().int().min(1).max(100).default(50).openapi({
      description: "How many of the document's lines to include, at most 100.",
    }),
    page: z.number().int().min(1).default(1).openapi({
      description: "The page of lines to include, from 1.",
    }),
  }),
  name: "get_document",
  operations: ["getDocument"],
  title: "Get a document",
});
