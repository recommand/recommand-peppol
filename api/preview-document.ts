import { Server, type Context } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure } from "@recommand/lib/utils";
import { z } from "zod";
import {
  DocumentType,
  sendDocumentSchema,
} from "@peppol/utils/parsing/send-document";
import {
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { addMonths, formatISO } from "date-fns";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import type { TransmittedDocument } from "@peppol/data/transmitted-documents";
import { renderDocumentHtml } from "@peppol/utils/document-renderer";
import { ulid } from "ulid";
import { parseDocument } from "@peppol/utils/parsing/parse-document";
import {
  CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  INVOICE_DOCUMENT_TYPE_INFO,
  MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { resolveDocumentXmlHandler } from "@peppol/utils/parsing/document-handlers";

const server = new Server();

const previewDocumentParamSchema = z.object({
  companyId: z.string(),
  type: z.enum(["html"]),
});

type PreviewDocumentContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: {
      param: z.input<typeof previewDocumentParamSchema>;
      json: z.input<typeof sendDocumentSchema>;
    };
    out: {
      param: z.infer<typeof previewDocumentParamSchema>;
      json: z.infer<typeof sendDocumentSchema>;
    };
  }
>;

const _previewDocument = server.post(
  "/:companyId/previewDocument/render/:type",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  describeRoute({ hide: true }),
  zodValidator("param", previewDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  _previewDocumentImplementation
);

async function _previewDocumentImplementation(c: PreviewDocumentContext) {
  try {
    const { type: outputType } = c.req.valid("param");
    if (outputType !== "html") {
      return c.json(actionFailure("Invalid preview type"), 400);
    }

    const input = c.req.valid("json");
    const company = c.var.company;
    const now = new Date();

    if (input.documentType === DocumentType.XML) {
      return c.json(
        actionFailure("Preview not available for raw XML documents."),
        400
      );
    }

    const draftId = "draft_" + ulid();
    const senderIdentifier = await getSendingCompanyIdentifier(company.id);
    const senderAddress = `${senderIdentifier.scheme}:${senderIdentifier.identifier}`;
    let recipientAddress = input.recipient ?? "0000:0000";
    if (!recipientAddress.includes(":")) {
      const numberOnlyRecipient = recipientAddress.replace(/[^0-9]/g, "");
      recipientAddress = "0208:" + numberOnlyRecipient;
    }

    if (input.documentType === DocumentType.INVOICE) {
      const invoice = input.document as Invoice;
      if (!invoice.seller) {
        invoice.seller = {
          vatNumber: company.vatNumber,
          enterpriseNumber: company.enterpriseNumber,
          name: company.name,
          street: company.address,
          city: company.city,
          postalZone: company.postalCode,
          country: company.country,
          email: company.email || null,
          phone: company.phone || null,
        };
      }
      if (!invoice.issueDate) {
        invoice.issueDate = formatISO(now, { representation: "date" });
      }
      if (!invoice.dueDate) {
        invoice.dueDate = formatISO(addMonths(new Date(invoice.issueDate), 1), {
          representation: "date",
        });
      }

      const docTypeId = input.doctypeId ?? INVOICE_DOCUMENT_TYPE_INFO.docTypeId;
      const xmlHandler = resolveDocumentXmlHandler(docTypeId, "invoice");
      if (!xmlHandler.ok) {
        return c.json(actionFailure(xmlHandler.message), 400);
      }
      const xml = xmlHandler.handler.toXml({
        document: invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced: true,
      });
      const parsed = parseDocument(
        docTypeId,
        xml,
        company,
        senderAddress
      );
      const parsedDocument = (parsed.parsedDocument as Invoice) ?? invoice;
      const docType: SupportedDocumentType =
        parsed.type !== "unknown" ? parsed.type : "invoice";
      const docForRender = {
        id: draftId,
        type: docType,
        parsed: parsedDocument,
      } as unknown as TransmittedDocument;
      return c.html(await renderDocumentHtml(docForRender));
    }

    if (input.documentType === DocumentType.CREDIT_NOTE) {
      const creditNote = input.document as CreditNote;
      if (!creditNote.seller) {
        creditNote.seller = {
          vatNumber: company.vatNumber,
          enterpriseNumber: company.enterpriseNumber,
          name: company.name,
          street: company.address,
          city: company.city,
          postalZone: company.postalCode,
          country: company.country,
          email: company.email || null,
          phone: company.phone || null,
        };
      }
      if (!creditNote.issueDate) {
        creditNote.issueDate = formatISO(now, { representation: "date" });
      }

      const docTypeId = input.doctypeId ?? CREDIT_NOTE_DOCUMENT_TYPE_INFO.docTypeId;
      const xmlHandler = resolveDocumentXmlHandler(docTypeId, "creditNote");
      if (!xmlHandler.ok) {
        return c.json(actionFailure(xmlHandler.message), 400);
      }
      const xml = xmlHandler.handler.toXml({
        document: creditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced: true,
      });
      const parsed = parseDocument(
        docTypeId,
        xml,
        company,
        senderAddress
      );
      const parsedDocument =
        (parsed.parsedDocument as CreditNote) ?? creditNote;
      const docType: SupportedDocumentType =
        parsed.type !== "unknown" ? parsed.type : "creditNote";
      const docForRender = {
        id: draftId,
        type: docType,
        parsed: parsedDocument,
      } as unknown as TransmittedDocument;
      return c.html(await renderDocumentHtml(docForRender));
    }

    if (input.documentType === DocumentType.SELF_BILLING_INVOICE) {
      const invoice = input.document as SelfBillingInvoice;
      if (!invoice.buyer) {
        invoice.buyer = {
          vatNumber: company.vatNumber,
          enterpriseNumber: company.enterpriseNumber,
          name: company.name,
          street: company.address,
          city: company.city,
          postalZone: company.postalCode,
          country: company.country,
          email: company.email || null,
          phone: company.phone || null,
        };
      }
      if (!invoice.issueDate) {
        invoice.issueDate = formatISO(now, { representation: "date" });
      }
      if (!invoice.dueDate) {
        invoice.dueDate = formatISO(addMonths(new Date(invoice.issueDate), 1), {
          representation: "date",
        });
      }

      const docTypeId = input.doctypeId ?? SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO.docTypeId;
      const xmlHandler = resolveDocumentXmlHandler(docTypeId, "selfBillingInvoice");
      if (!xmlHandler.ok) {
        return c.json(actionFailure(xmlHandler.message), 400);
      }
      const xml = xmlHandler.handler.toXml({
        document: invoice,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced: true,
      });
      const parsed = parseDocument(
        docTypeId,
        xml,
        company,
        senderAddress
      );
      const parsedDocument =
        (parsed.parsedDocument as SelfBillingInvoice) ?? invoice;
      const docType: SupportedDocumentType =
        parsed.type !== "unknown" ? parsed.type : "selfBillingInvoice";
      const docForRender = {
        id: draftId,
        type: docType,
        parsed: parsedDocument,
      } as unknown as TransmittedDocument;
      return c.html(await renderDocumentHtml(docForRender));
    }

    if (input.documentType === DocumentType.SELF_BILLING_CREDIT_NOTE) {
      const creditNote = input.document as SelfBillingCreditNote;
      if (!creditNote.buyer) {
        creditNote.buyer = {
          vatNumber: company.vatNumber,
          enterpriseNumber: company.enterpriseNumber,
          name: company.name,
          street: company.address,
          city: company.city,
          postalZone: company.postalCode,
          country: company.country,
          email: company.email || null,
          phone: company.phone || null,
        };
      }
      if (!creditNote.issueDate) {
        creditNote.issueDate = formatISO(now, { representation: "date" });
      }

      const docTypeId = input.doctypeId ?? SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO.docTypeId;
      const xmlHandler = resolveDocumentXmlHandler(docTypeId, "selfBillingCreditNote");
      if (!xmlHandler.ok) {
        return c.json(actionFailure(xmlHandler.message), 400);
      }
      const xml = xmlHandler.handler.toXml({
        document: creditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced: true,
      });
      const parsed = parseDocument(
        docTypeId,
        xml,
        company,
        senderAddress
      );
      const parsedDocument =
        (parsed.parsedDocument as SelfBillingCreditNote) ?? creditNote;
      const docType: SupportedDocumentType =
        parsed.type !== "unknown" ? parsed.type : "selfBillingCreditNote";
      const docForRender = {
        id: draftId,
        type: docType,
        parsed: parsedDocument,
      } as unknown as TransmittedDocument;
      return c.html(await renderDocumentHtml(docForRender));
    }

    if (input.documentType === DocumentType.MESSAGE_LEVEL_RESPONSE) {
      const messageLevelResponse = input.document as MessageLevelResponse;
      if (!messageLevelResponse.id) {
        messageLevelResponse.id = Bun.randomUUIDv7();
      }
      if (!messageLevelResponse.issueDate) {
        messageLevelResponse.issueDate = formatISO(now, {
          representation: "date",
        });
      }

      const docTypeId = input.doctypeId ?? MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO.docTypeId;
      const xmlHandler = resolveDocumentXmlHandler(docTypeId, "messageLevelResponse");
      if (!xmlHandler.ok) {
        return c.json(actionFailure(xmlHandler.message), 400);
      }
      const xml = xmlHandler.handler.toXml({
        document: messageLevelResponse,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced: true,
      });
      const parsed = parseDocument(
        docTypeId,
        xml,
        company,
        senderAddress
      );
      const parsedDocument =
        (parsed.parsedDocument as MessageLevelResponse) ?? messageLevelResponse;
      const docType: SupportedDocumentType =
        parsed.type !== "unknown" ? parsed.type : "messageLevelResponse";
      const docForRender = {
        id: draftId,
        type: docType,
        parsed: parsedDocument,
      } as unknown as TransmittedDocument;
      return c.html(await renderDocumentHtml(docForRender));
    }

    return c.json(
      actionFailure("Preview not available for this document."),
      400
    );
  } catch (error) {
    return c.json(
      actionFailure(
        error instanceof Error ? error.message : "Failed to render preview"
      ),
      400
    );
  }
}

export type PreviewDocument = typeof _previewDocument;
export default server;
