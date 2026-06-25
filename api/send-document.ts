import { Server, type Context } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { invoiceToUBL } from "@peppol/utils/parsing/invoice/to-xml";
import { sendDocumentSchema, DocumentType } from "utils/parsing/send-document";
import {
  sendInvoiceSchema,
  type Invoice,
} from "@peppol/utils/parsing/invoice/schemas";
import { sendAs4, type SendAs4Response } from "@peppol/data/phase4-ap/client";
import { db } from "@recommand/db";
import { transferEvents, transmittedDocuments } from "@peppol/db/schema";
import { parsedHasAttachments } from "@peppol/data/offload/storage";
import {
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  requireCompanyVerificationForStrictTeams,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { addMonths, formatISO } from "date-fns";
import {
  sendCreditNoteSchema,
  type CreditNote,
} from "@peppol/utils/parsing/creditnote/schemas";
import { creditNoteToUBL } from "@peppol/utils/parsing/creditnote/to-xml";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { simulateSendAs4 } from "@peppol/data/playground/simulate-ap";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import {
  detectDoctypeId,
  parseDocument,
} from "@peppol/utils/parsing/parse-document";
import { sendDocumentEmail } from "@peppol/data/email/send-email";
import {
  sendSelfBillingInvoiceSchema,
  type SelfBillingInvoice,
} from "@peppol/utils/parsing/self-billing-invoice/schemas";
import { selfBillingInvoiceToUBL } from "@peppol/utils/parsing/self-billing-invoice/to-xml";
import {
  sendSelfBillingCreditNoteSchema,
  type SelfBillingCreditNote,
} from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import { selfBillingCreditNoteToUBL } from "@peppol/utils/parsing/self-billing-creditnote/to-xml";
import { sendOutgoingDocumentNotifications } from "@peppol/data/send-document-notifications";
import { z } from "zod";
import { publishEvent } from "@core/data/rules/events";
import type {
  AuthenticatedUserContext,
  AuthenticatedTeamContext,
} from "@core/lib/auth-middleware";
import { validateXmlDocument } from "@peppol/data/validation/client";
import type { ValidationResponse } from "@peppol/types/validation";
import {
  BILLING_DOCUMENT_TYPE_INFO,
  CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  getDocumentTypeInfo,
  INVOICE_DOCUMENT_TYPE_INFO,
  MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
  SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import {
  messageLevelResponseSchema,
  type MessageLevelResponse,
} from "@peppol/utils/parsing/message-level-response/schemas";
import { messageLevelResponseToXML } from "@peppol/utils/parsing/message-level-response/to-xml";
import { ulid } from "ulid";
import { generateAndAttachPdf } from "@peppol/utils/pdf-attachment-helper";
import {
  type ParsedDocument as FilenameParsedDocument,
} from "@peppol/utils/document-filename";
import { getTransmittedDocumentSearchFields } from "@peppol/utils/transmitted-document-search";
import { audit } from "@core/lib/audit";

const server = new Server();

const sendDocumentResponse = z.object({
  sentOverPeppol: z.boolean(),
  sentOverEmail: z.boolean(),
  emailRecipients: z.array(z.string()),
  teamId: z.string(),
  companyId: z.string(),
  id: z.string(),
  peppolMessageId: z.string().nullable(),
  envelopeId: z.string().nullable(),
});

const routeDescription = describeRoute({
  operationId: "sendDocument",
  description: "Send a document to a customer",
  summary: "Send Document",
  tags: ["Sending"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully sent document",
      sendDocumentResponse
    ),
    ...describeErrorResponse(400, "Invalid document data provided"),
    ...describeErrorResponse(
      422,
      "Recipient could not be reached and no email fallback was configured or possible"
    ),
  },
});

type SendDocumentContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof sendDocumentSchema> };
    out: { json: z.infer<typeof sendDocumentSchema> };
  }
>;

const _sendDocument = server.post(
  "/:companyId/sendDocument",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  describeRoute({ hide: true }),
  zodValidator("json", sendDocumentSchema),
  _sendDocumentImplementation
);

const _sendDocumentMinimal = server.post(
  "/:companyId/send",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  routeDescription,
  zodValidator("json", sendDocumentSchema),
  _sendDocumentImplementation
);

const RECIPIENT_NULL_FALLBACK_ADDRESS = "0000:0000"; // Used for null recipient to be able to generate a PDF

async function _sendDocumentImplementation(c: SendDocumentContext) {
  let inputFormat = "unknown";

  try {
    const input = c.req.valid("json");
    inputFormat = input.documentType === DocumentType.XML ? "xml" : "json_api";
    const document = input.document;
    const isPlayground = c.get("team").isPlayground;
    const useTestNetwork = c.get("team").useTestNetwork ?? false;
    const transmittedDocumentId = "doc_" + ulid();
    const customPdfFilename = input.pdfGeneration?.filename?.trim() || undefined;

    // Check if recipient is null - only billing document types are supported
    const isRecipientNull = input.recipient === null;
    if (isRecipientNull) {
      const billingTypes = BILLING_DOCUMENT_TYPE_INFO.map(dt => dt.type) as DocumentType[];
      if (!billingTypes.includes(input.documentType)) {
        return c.json(
          actionFailure(
            `Only billing document types (${billingTypes.join(", ")}) are supported when recipient is null.`
          ),
          400
        );
      }
    }

    // Early validation: ensure either recipient or email.to is provided
    if (isRecipientNull && !input.email?.to?.length) {
      return c.json(
        actionFailure("Either recipient (for Peppol) or email.to (for email delivery) must be provided."),
        400
      );
    }

    let xmlDocument: string | null = null;
    let type: SupportedDocumentType = "unknown";
    let probableType: SupportedDocumentType = "unknown";
    let parsedDocument: FilenameParsedDocument | null = null;
    let doctypeId: string = INVOICE_DOCUMENT_TYPE_INFO.docTypeId;

    // Get senderId, countryC1 from company
    const company = c.var.company;
    const senderIdentifier = await getSendingCompanyIdentifier(company.id);
    const senderAddress = `${senderIdentifier.scheme}:${senderIdentifier.identifier}`;
    const countryC1 = company.country;

    // Parse recipient
    let recipientAddress: string | null = input.recipient;
    if (recipientAddress !== null && !recipientAddress.includes(":")) {
      const numberOnlyRecipient = recipientAddress.replace(/[^0-9]/g, "");
      recipientAddress = "0208:" + numberOnlyRecipient;
    }

    if (input.documentType === DocumentType.INVOICE) {
      const invoice = document as Invoice;

      // Check the invoice corresponds to the required zod schema
      const parsedInvoice = sendInvoiceSchema.safeParse(invoice);
      if (!parsedInvoice.success) {
        return c.json(
          actionFailure(
            "Invalid invoice data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu"
          ),
          400
        );
      }

      if (!invoice.seller) {
        invoice.seller = {
          vatNumber: c.var.company.vatNumber,
          enterpriseNumberScheme: c.var.company.enterpriseNumberScheme,
          enterpriseNumber: c.var.company.enterpriseNumber,
          name: c.var.company.name,
          street: c.var.company.address,
          city: c.var.company.city,
          postalZone: c.var.company.postalCode,
          country: c.var.company.country,
          email: c.var.company.email || null,
          phone: c.var.company.phone || null,
        };
      }
      if (!invoice.issueDate) {
        invoice.issueDate = formatISO(new Date(), { representation: "date" });
      }
      if (!invoice.dueDate) {
        invoice.dueDate = formatISO(addMonths(new Date(invoice.issueDate), 1), {
          representation: "date",
        });
      }
      let ublInvoice = invoiceToUBL({
        invoice,
        senderAddress,
        recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
        isDocumentValidationEnforced: true,
      });
      let parsed = parseDocument(doctypeId, ublInvoice, company, senderAddress);

      if (input.pdfGeneration?.enabled) {
        const parsedForPdf = (parsed.parsedDocument as Invoice) ?? invoice;
        invoice.attachments = await generateAndAttachPdf(transmittedDocumentId, "invoice", parsedForPdf, invoice.attachments, customPdfFilename);

        ublInvoice = invoiceToUBL({
          invoice,
          senderAddress,
          recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
          isDocumentValidationEnforced: true,
        });
        parsed = parseDocument(doctypeId, ublInvoice, company, senderAddress);
      }

      if (!isRecipientNull) {
        xmlDocument = ublInvoice;
      }
      type = "invoice";

      if (parsed.parsedDocument) {
        parsedDocument = parsed.parsedDocument as Invoice;
        type = parsed.type;
      } else {
        parsedDocument = invoice;
      }
    } else if (input.documentType === DocumentType.CREDIT_NOTE) {
      const creditNote = document as CreditNote;

      // Check the credit note corresponds to the required zod schema
      const parsedCreditNote = sendCreditNoteSchema.safeParse(creditNote);
      if (!parsedCreditNote.success) {
        return c.json(
          actionFailure(
            "Invalid credit note data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu"
          ),
          400
        );
      }

      if (!creditNote.seller) {
        creditNote.seller = {
          vatNumber: c.var.company.vatNumber,
          enterpriseNumberScheme: c.var.company.enterpriseNumberScheme,
          enterpriseNumber: c.var.company.enterpriseNumber,
          name: c.var.company.name,
          street: c.var.company.address,
          city: c.var.company.city,
          postalZone: c.var.company.postalCode,
          country: c.var.company.country,
          email: c.var.company.email || null,
          phone: c.var.company.phone || null,
        };
      }
      if (!creditNote.issueDate) {
        creditNote.issueDate = formatISO(new Date(), {
          representation: "date",
        });
      }
      doctypeId = CREDIT_NOTE_DOCUMENT_TYPE_INFO.docTypeId;
      let ublCreditNote = creditNoteToUBL({
        creditNote,
        senderAddress,
        recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
        isDocumentValidationEnforced: true,
      });
      let parsed = parseDocument(
        doctypeId,
        ublCreditNote,
        company,
        senderAddress
      );

      if (input.pdfGeneration?.enabled) {
        const parsedForPdf =
          (parsed.parsedDocument as CreditNote) ?? creditNote;
        creditNote.attachments = await generateAndAttachPdf(transmittedDocumentId, "creditNote", parsedForPdf, creditNote.attachments, customPdfFilename);

        ublCreditNote = creditNoteToUBL({
          creditNote,
          senderAddress,
          recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
          isDocumentValidationEnforced: true,
        });
        parsed = parseDocument(
          doctypeId,
          ublCreditNote,
          company,
          senderAddress
        );
      }

      if (!isRecipientNull) {
        xmlDocument = ublCreditNote;
      }
      type = "creditNote";

      if (parsed.parsedDocument) {
        parsedDocument = parsed.parsedDocument as CreditNote;
        type = parsed.type;
      } else {
        parsedDocument = creditNote;
      }
    } else if (input.documentType === DocumentType.SELF_BILLING_INVOICE) {
      const invoice = document as SelfBillingInvoice;

      // Check the invoice corresponds to the required zod schema
      const parsedInvoice = sendSelfBillingInvoiceSchema.safeParse(invoice);
      if (!parsedInvoice.success) {
        return c.json(
          actionFailure(
            "Invalid self billing invoice data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu"
          ),
          400
        );
      }

      if (!invoice.buyer) {
        invoice.buyer = {
          vatNumber: c.var.company.vatNumber,
          enterpriseNumberScheme: c.var.company.enterpriseNumberScheme,
          enterpriseNumber: c.var.company.enterpriseNumber,
          name: c.var.company.name,
          street: c.var.company.address,
          city: c.var.company.city,
          postalZone: c.var.company.postalCode,
          country: c.var.company.country,
          email: c.var.company.email || null,
          phone: c.var.company.phone || null,
        };
      }
      if (!invoice.issueDate) {
        invoice.issueDate = formatISO(new Date(), { representation: "date" });
      }
      if (!invoice.dueDate) {
        invoice.dueDate = formatISO(addMonths(new Date(invoice.issueDate), 1), {
          representation: "date",
        });
      }
      doctypeId = SELF_BILLING_INVOICE_DOCUMENT_TYPE_INFO.docTypeId;
      let ublInvoice = selfBillingInvoiceToUBL({
        selfBillingInvoice: invoice,
        senderAddress,
        recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
        isDocumentValidationEnforced: true,
      });
      let parsed = parseDocument(doctypeId, ublInvoice, company, senderAddress);

      if (input.pdfGeneration?.enabled) {
        const parsedForPdf =
          (parsed.parsedDocument as SelfBillingInvoice) ?? invoice;
        invoice.attachments = await generateAndAttachPdf(transmittedDocumentId, "selfBillingInvoice", parsedForPdf, invoice.attachments, customPdfFilename);

        ublInvoice = selfBillingInvoiceToUBL({
          selfBillingInvoice: invoice,
          senderAddress,
          recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
          isDocumentValidationEnforced: true,
        });
        parsed = parseDocument(doctypeId, ublInvoice, company, senderAddress);
      }

      if (!isRecipientNull) {
        xmlDocument = ublInvoice;
      }
      type = "selfBillingInvoice";

      if (parsed.parsedDocument) {
        parsedDocument = parsed.parsedDocument as SelfBillingInvoice;
        type = parsed.type;
      } else {
        parsedDocument = invoice;
      }
    } else if (input.documentType === DocumentType.SELF_BILLING_CREDIT_NOTE) {
      const selfBillingCreditNote = document as SelfBillingCreditNote;

      // Check the credit note corresponds to the required zod schema
      const parsedCreditNote = sendSelfBillingCreditNoteSchema.safeParse(
        selfBillingCreditNote
      );
      if (!parsedCreditNote.success) {
        return c.json(
          actionFailure(
            "Invalid self billing credit note data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu"
          ),
          400
        );
      }

      if (!selfBillingCreditNote.buyer) {
        selfBillingCreditNote.buyer = {
          vatNumber: c.var.company.vatNumber,
          enterpriseNumberScheme: c.var.company.enterpriseNumberScheme,
          enterpriseNumber: c.var.company.enterpriseNumber,
          name: c.var.company.name,
          street: c.var.company.address,
          city: c.var.company.city,
          postalZone: c.var.company.postalCode,
          country: c.var.company.country,
          email: c.var.company.email || null,
          phone: c.var.company.phone || null,
        };
      }
      if (!selfBillingCreditNote.issueDate) {
        selfBillingCreditNote.issueDate = formatISO(new Date(), {
          representation: "date",
        });
      }
      doctypeId = SELF_BILLING_CREDIT_NOTE_DOCUMENT_TYPE_INFO.docTypeId;
      let ublSelfBillingCreditNote = selfBillingCreditNoteToUBL({
        selfBillingCreditNote,
        senderAddress,
        recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
        isDocumentValidationEnforced: true,
      });
      let parsed = parseDocument(
        doctypeId,
        ublSelfBillingCreditNote,
        company,
        senderAddress
      );

      if (input.pdfGeneration?.enabled) {
        const parsedForPdf =
          (parsed.parsedDocument as SelfBillingCreditNote) ??
          selfBillingCreditNote;
        selfBillingCreditNote.attachments = await generateAndAttachPdf(transmittedDocumentId, "selfBillingCreditNote", parsedForPdf, selfBillingCreditNote.attachments, customPdfFilename);

        ublSelfBillingCreditNote = selfBillingCreditNoteToUBL({
          selfBillingCreditNote,
          senderAddress,
          recipientAddress: recipientAddress ?? RECIPIENT_NULL_FALLBACK_ADDRESS,
          isDocumentValidationEnforced: true,
        });
        parsed = parseDocument(
          doctypeId,
          ublSelfBillingCreditNote,
          company,
          senderAddress
        );
      }

      if (!isRecipientNull) {
        xmlDocument = ublSelfBillingCreditNote;
      }
      type = "selfBillingCreditNote";

      if (parsed.parsedDocument) {
        parsedDocument = parsed.parsedDocument as SelfBillingCreditNote;
        type = parsed.type;
      } else {
        parsedDocument = selfBillingCreditNote;
      }
    } else if (input.documentType === DocumentType.MESSAGE_LEVEL_RESPONSE) {
      if (input.pdfGeneration?.enabled) {
        return c.json(
          actionFailure(
            "PDF generation is not supported for message level responses."
          ),
          400
        );
      }
      const messageLevelResponse = document as MessageLevelResponse;

      if (!messageLevelResponse.id) {
        messageLevelResponse.id = Bun.randomUUIDv7();
      }
      if (!messageLevelResponse.issueDate) {
        messageLevelResponse.issueDate = formatISO(new Date(), {
          representation: "date",
        });
      }

      // Check the message level response corresponds to the required zod schema
      const parsedMessageLevelResponse =
        messageLevelResponseSchema.safeParse(messageLevelResponse);
      if (!parsedMessageLevelResponse.success) {
        return c.json(
          actionFailure(
            "Invalid message level response data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu"
          ),
          400
        );
      }

      xmlDocument = messageLevelResponseToXML({
        messageLevelResponse,
        senderAddress,
        recipientAddress: recipientAddress!,
      });
      type = "messageLevelResponse";
      doctypeId = MESSAGE_LEVEL_RESPONSE_DOCUMENT_TYPE_INFO.docTypeId;

      const parsed = parseDocument(
        doctypeId,
        xmlDocument,
        company,
        senderAddress
      );

      if (parsed.parsedDocument) {
        parsedDocument = parsed.parsedDocument as MessageLevelResponse;
        type = parsed.type;
      } else {
        parsedDocument = messageLevelResponse;
      }
    } else if (input.documentType === DocumentType.XML) {
      if (input.pdfGeneration?.enabled) {
        return c.json(
          actionFailure(
            "PDF generation is not supported for raw XML documents."
          ),
          400
        );
      }
      xmlDocument = document as string;
      if (input.doctypeId) {
        doctypeId = input.doctypeId;
      } else {
        doctypeId = detectDoctypeId(xmlDocument) || "";
        if (!doctypeId) {
          return c.json(
            actionFailure(
              "Document type could not be detected automatically from your XML document. Please provide the doctypeId manually."
            ),
            400
          );
        }
      }

      const parsed = parseDocument(
        doctypeId,
        xmlDocument,
        company,
        senderAddress
      );

      parsedDocument = parsed.parsedDocument;
      type = parsed.type;
      probableType = parsed.probableType; // We don't want to block if something goes wrong with the parsing, so we use the probableType for XML documents
    } else {
      return c.json(actionFailure("Invalid document type provided."), 400);
    }

    let validation: ValidationResponse | undefined;

    if (!isRecipientNull) {
      if (!xmlDocument) {
        return c.json(actionFailure("Document could not be parsed."), 400);
      }

      validation = await validateXmlDocument(xmlDocument);
      if (validation.result === "invalid") {
        // Only stop sending if explicitly invalid
        // Transform into key (ruleCode) value (errorMessage) object
        const errors: Record<string, string[]> = validation.errors.reduce(
          (acc: Record<string, string[]>, error) => {
            const ruleErrors = acc[error.fieldName] || [];
            const message = `${error.ruleCode}: ${error.errorMessage}`;
            if (!ruleErrors.includes(message)) {
              acc[error.fieldName] = [...ruleErrors, message];
            }
            return acc;
          },
          {}
        );
        return c.json(
          actionFailure({
            root: [
              "Document validation failed. Please ensure your document complies with EN16931 and PEPPOL BIS 3.0 requirements.",
            ],
            ...errors,
          }),
          400
        );
      }
    }

    let sentPeppol = false;
    let sentEmailRecipients: string[] = [];
    let additionalPeppolFailureContext = "";
    let additionalEmailFailureContext = "";

    let processId: string = "";
    if (input.processId) {
      processId = input.processId;
    } else {
      try {
        let typeToInspect = type;
        if (type === "unknown" && probableType !== "unknown") {
          typeToInspect = probableType;
        }
        processId = getDocumentTypeInfo(typeToInspect).processId;
      } catch (error) {
        console.error("Failed to get process id:", error);
        sendSystemAlert(
          "Process ID Detection Failed",
          `Failed to detect process id. Error: \`\`\`\n${error}\n\`\`\``,
          "error"
        );
        return c.json(
          actionFailure(
            "Failed to detect process id. Please provide the processId manually."
          ),
          400
        );
      }
    }

    let as4Response: SendAs4Response | null = null;
    if (!isRecipientNull) {
      if (isPlayground && !useTestNetwork) {
        try {
          await simulateSendAs4({
            senderId: senderAddress,
            receiverId: recipientAddress!,
            docTypeId: doctypeId,
            processId,
            countryC1: countryC1,
            body: xmlDocument!,
            playgroundTeamId: c.var.team.id, // Must be the same as the sender team: we don't support cross-team sending
          });
          sentPeppol = true;
        } catch (error) {
          console.error("Failed to simulate send as4:", error);
          additionalPeppolFailureContext =
            error instanceof Error
              ? error.message
              : "No additional context available, please contact support@recommand.eu if you could use our help.";

          // If send over email is disabled, return an error
          if (!input.email) {
            return c.json(
              actionFailure(
                `Failed to send document over Peppol network. ${additionalPeppolFailureContext}`
              ),
              422
            );
          }
        }
      } else {
        as4Response = await sendAs4({
          senderId: senderAddress,
          receiverId: recipientAddress!,
          docTypeId: doctypeId,
          processId,
          countryC1: countryC1,
          body: xmlDocument!,
          useTestNetwork,
        });
        if (!as4Response.ok) {
          sendSystemAlert(
            "Document Sending Failed",
            `Failed to send document over Peppol network. Response: \`\`\`\n${JSON.stringify(as4Response, null, 2)}\n\`\`\``,
            "error"
          );
          // Extract sendingException.message from jsonResponse
          const sendingException = as4Response.sendingException;
          additionalPeppolFailureContext =
            sendingException?.message ??
            "No additional context available, please contact support@recommand.eu if you could use our help.";

          // If send over email is disabled, return an error
          if (!input.email) {
            return c.json(
              actionFailure(
                `Failed to send document over Peppol network. ${additionalPeppolFailureContext}`
              ),
              422
            );
          }
        } else {
          sentPeppol = true;
        }
      }
    }

    // If send over email is enabled, send the email
    if (input.email && (input.email.when === "always" || !sentPeppol)) {
      for (const recipient of input.email.to) {
        try {
          await sendDocumentEmail({
            to: recipient,
            subject: input.email.subject,
            htmlBody: input.email.htmlBody,
            xmlDocument: xmlDocument,
            type,
            parsedDocument: parsedDocument,
            isPlayground,
          });
          sentEmailRecipients.push(recipient);
        } catch (error) {
          console.error("Failed to send email:", error);
          additionalEmailFailureContext =
            error instanceof Error
              ? error.message
              : "No additional context available, please contact support@recommand.eu if you could use our help.";
        }
      }
    }

    if (!sentPeppol && sentEmailRecipients.length === 0) {
      sendSystemAlert(
        "Document Sending Failed",
        `Failed to send document over Peppol network and email. ${additionalPeppolFailureContext} ${additionalEmailFailureContext}`,
        "error"
      );
      return c.json(
        actionFailure(
          `Failed to send document over Peppol network and email. ${additionalPeppolFailureContext} ${additionalEmailFailureContext}`
        ),
        422
      );
    }

    // Create a new transmittedDocument
    const transmittedDocumentSearchFields = getTransmittedDocumentSearchFields({
      id: transmittedDocumentId,
      senderId: senderAddress,
      receiverId: recipientAddress,
      docTypeId: doctypeId,
      processId,
      countryC1,
      type,
      parsedDocument,
    });

    const transmittedDocument = await db
      .insert(transmittedDocuments)
      .values({
        id: transmittedDocumentId,
        teamId: c.var.team.id,
        companyId: company.id,
        direction: "outgoing",
        senderId: senderAddress,
        receiverId: recipientAddress,
        docTypeId: doctypeId,
        processId,
        countryC1: countryC1,
        xml: xmlDocument,
        xmlLocation: xmlDocument != null ? "db" : "none",
        attachmentsLocation: parsedHasAttachments(parsedDocument) ? "db" : "none",

        sentOverPeppol: sentPeppol,
        sentOverEmail: sentEmailRecipients.length > 0,
        emailRecipients: sentEmailRecipients,

        type,
        parsed: parsedDocument,
        validation,
        ...transmittedDocumentSearchFields,

        peppolMessageId: as4Response?.peppolMessageId ?? null,
        peppolConversationId: as4Response?.peppolConversationId ?? null,
        receivedPeppolSignalMessage:
          as4Response?.receivedPeppolSignalMessage ?? null,
        envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
      })
    .returning({ id: transmittedDocuments.id })
    .then((rows) => rows[0]);

    await publishEvent("peppol.document.sent.v1", {
      teamId: c.var.team.id,
      aggregateType: "peppol.document",
      aggregateId: transmittedDocument.id,
      idempotencyKey: `peppol.document.sent:${transmittedDocument.id}`,
      payload: {
        companyId: company.id,
        docType: type,
        senderId: senderAddress,
        receiverId: recipientAddress,
        peppolMessageId: as4Response?.peppolMessageId ?? null,
        peppolConversationId: as4Response?.peppolConversationId ?? null,
        envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
        countryC1,
      },
    });

    // Create a new transferEvent for billing
    if (!isPlayground) {
      const te: (typeof transferEvents.$inferInsert)[] = [];
      if (sentPeppol) {
        te.push({
          teamId: c.var.team.id,
          companyId: company.id,
          direction: "outgoing",
          type: "peppol",
          transmittedDocumentId: transmittedDocument.id,
        });
      }
      for (const _ of sentEmailRecipients) {
        te.push({
          teamId: c.var.team.id,
          companyId: company.id,
          direction: "outgoing",
          type: "email",
          transmittedDocumentId: transmittedDocument.id,
        });
      }
      await db.insert(transferEvents).values(te);
    }

    // Send notification emails to configured addresses
    try {
      await sendOutgoingDocumentNotifications({
        transmittedDocumentId: transmittedDocument.id,
        companyId: company.id,
        companyName: company.name,
        type,
        parsedDocument,
        xmlDocument: xmlDocument,
        isPlayground,
      });
    } catch (error) {
      console.error("Failed to send outgoing document notifications:", error);
      sendSystemAlert(
        "Document Notification Sending Failed",
        `Failed to send outgoing document notification for document ${transmittedDocument.id}.`,
        "error"
      );
    }

    await audit(c, {
      action: "create",
      subsystem: "peppol.documents",
      objectType: "peppol.document",
      objectId: transmittedDocument.id,
      teamId: c.var.team.id,
      after: {
        companyId: company.id,
        direction: "outgoing",
        type,
        sentOverPeppol: sentPeppol,
        sentOverEmail: sentEmailRecipients.length > 0,
      },
      metadata: {
        inputFormat,
        senderId: senderAddress,
        receiverId: recipientAddress,
        docTypeId: doctypeId,
        processId,
        peppolMessageId: as4Response?.peppolMessageId ?? null,
        envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
      },
    });

    return c.json(
      actionSuccess({
        teamId: c.var.team.id,
        companyId: company.id,
        id: transmittedDocument.id,
        peppolMessageId: as4Response?.peppolMessageId ?? null,
        envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
        sentOverPeppol: sentPeppol,
        sentOverEmail: sentEmailRecipients.length > 0,
        emailRecipients: sentEmailRecipients,
        ...(additionalPeppolFailureContext
          ? { additionalPeppolFailureContext }
          : {}),
        ...(additionalEmailFailureContext
          ? { additionalEmailFailureContext }
          : {}),
      })
    );
  } catch (error) {
    console.error(error);

    await audit(c, {
      action: "create",
      subsystem: "peppol.documents",
      outcome: "failed",
      objectType: "peppol.document",
      reasonCode: "send_document_failed",
      metadata: {
        inputFormat,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    sendSystemAlert(
      "Document Sending Failed",
      `Failed to send document over Peppol network. Error: \`\`\`\n${error}\n\`\`\``,
      "error"
    );

    return c.json(
      actionFailure(
        error instanceof Error ? error.message : "Failed to send document"
      ),
      400
    );
  }
}

export type SendDocument = typeof _sendDocument | typeof _sendDocumentMinimal;

export default server;
