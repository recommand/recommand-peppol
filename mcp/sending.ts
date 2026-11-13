import { z, ZodError } from "zod";
import "zod-openapi/extend";
import { createSchema } from "zod-openapi";
import { McpToolError, registerTool } from "@core/lib/mcp/tools";
import type { Company } from "@peppol/data/companies";
import { getCompanyById } from "@peppol/data/companies";
import { createPreparedSend } from "@peppol/data/prepared-sends";
import { getExtendedTeam } from "@peppol/data/teams";
import { checkPeppolEntitlement, PEPPOL_ENTITLEMENTS } from "@peppol/lib/entitlements";
import { documentDetails } from "@peppol/mcp/document-details";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import {
  documentSendSchema,
  documentTypeSchema,
  sendDocumentBaseShape,
  sendDocumentSchema,
} from "@peppol/utils/parsing/send-document";
import { SendingFailure } from "@peppol/utils/pipelines/sending/errors";
import { prepareSend } from "@peppol/utils/pipelines/sending/prepare-send";
import { requiresCompanyVerification } from "@peppol/utils/playground";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { UserFacingError } from "@peppol/utils/util";

/** A request's schema errors as one message, each with the field it's about. */
const issuesMessage = (error: ZodError) =>
  error.issues.map(({ message, path }) => (path.length > 0 ? `${path.join(".")}: ${message}` : message)).join("\n");

/** A send's refusal as one message: the request's own problems first, then each field's. */
const sendingFailureMessage = (payload: string | Record<string, string[]>) => {
  if (typeof payload === "string") {
    return payload;
  }

  const { root = [], ...fields } = payload;

  return [...root, ...Object.entries(fields).flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))].join(
    "\n"
  );
};

// The fields a send fills in itself when they're left out: from the day it's sent on, such as an invoice's
// dates, from the company that sends, as the seller or, self-billing, the buyer, or a new ID, such as a
// message level response's
const FILLED_IN_FIELDS = ["buyer", "dueDate", "id", "issueDate", "seller", "statusDate"];

/**
 * The request with the fields a send would fill in written out, so a document sent later is the one that
 * was checked: an invoice prepared just before midnight keeps the day it was checked on.
 */
const withFilledInFields = (input: SendDocument, company: Company): SendDocument => {
  const documentType = getDocumentType(input.documentType);
  if (!documentType || typeof input.document !== "object") {
    return input;
  }

  const filledIn: Record<string, unknown> = documentType.preprocessFromSendAPI(input, { company });
  const document = input.document as Record<string, unknown>;

  return sendDocumentSchema.parse({
    ...input,
    document: {
      ...document,
      ...Object.fromEntries(FILLED_IN_FIELDS.filter((field) => !document[field] && filledIn[field]).map((field) => [field, filledIn[field]])),
    },
  });
};

registerTool({
  annotations: { openWorldHint: false, readOnlyHint: true },
  description:
    "Get the fields of a document type, as JSON Schema: what prepare_send takes as `document` for that `documentType`. Call it before preparing a document of a type you haven't written yet.",
  handler: async (_, { documentType }) => {
    const { components = {}, schema } = createSchema(documentSendSchema(documentType), {
      componentRefPath: "#/$defs/",
      schemaType: "input",
    });
    // A named schema comes back as a reference to itself; the model reads it more easily written out
    const rootName = "$ref" in schema ? schema.$ref.replace("#/$defs/", "") : null;
    const { [rootName ?? ""]: root, ...definitions } = components as Record<string, object>;

    return {
      documentType,
      schema: { ...(root ?? schema), ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}) },
    };
  },
  input: z.object({
    documentType: documentTypeSchema.openapi({
      description: "The document type to describe, such as `invoice`.",
    }),
  }),
  name: "describe_document",
  operations: ["sendDocument"],
  title: "Describe a document type",
});

registerTool({
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  description:
    "Check a document before sending it, without sending it: it's written, routed to the recipient and validated the way a send would. Call describe_document first for the fields `document` takes. Returns a summary to show the user, and a `handle` for exactly this document, valid for 15 minutes.",
  handler: async ({ team }, { companyId, ...fields }) => {
    const [company, extendedTeam] = await Promise.all([getCompanyById(companyId), getExtendedTeam(team.id)]);
    if (!company || company.teamId !== team.id || !extendedTeam) {
      throw new McpToolError(`There's no company ${companyId} in this team.`, "not_found");
    }

    // As the send routes do, before anything is written or looked up for the document
    const entitlement = await checkPeppolEntitlement(extendedTeam, PEPPOL_ENTITLEMENTS.TRANSACTIONS);
    if (!entitlement.allowed) {
      throw new McpToolError(entitlement.message ?? "This team cannot exchange documents.", "not_allowed");
    }

    if (
      !company.isVerified &&
      requiresCompanyVerification({
        smpProvider: company.smpProvider,
        useTestNetwork: extendedTeam.useTestNetwork,
        verificationRequirements: extendedTeam.verificationRequirements,
      })
    ) {
      throw new McpToolError("The company must be verified before it sends documents. Verify it first.", "not_allowed");
    }

    // `document` is only an object to the model, so it's checked here against its type's schema
    const request = sendDocumentSchema.safeParse(fields);
    if (!request.success) {
      throw new McpToolError(issuesMessage(request.error), "invalid_input");
    }

    try {
      const input = withFilledInFields(request.data, company);
      const { prepared, recipientAddress, validation } = await prepareSend({ company, input, team: extendedTeam });
      // Routed once: the send names the format and process the document was written and validated in, rather
      // than asking the recipient again
      const routing =
        recipientAddress !== null && input.documentType !== "xml" && !prepared.peppolRoutingFailure
          ? { doctypeId: prepared.docTypeId, processId: prepared.processId }
          : {};
      const preparedSend = await createPreparedSend({
        companyId,
        // Only a route the recipient was asked for, not one the request named itself
        fixedRoute: "doctypeId" in routing && !(input.doctypeId && input.processId),
        input: { ...input, ...routing },
        teamId: team.id,
      });

      return {
        document: { ...documentDetails(prepared.type, prepared.parsed), type: prepared.type },
        email: input.email ? { to: input.email.to, when: input.email.when } : null,
        expiresAt: preparedSend.expiresAt,
        handle: preparedSend.id,
        // The recipient receives nothing this document can be written as, so only email can deliver it
        peppolRoutingFailure: prepared.peppolRoutingFailure ?? null,
        recipient: recipientAddress,
        validation: validation?.result ?? null,
      };
    } catch (error) {
      if (error instanceof SendingFailure) {
        throw new McpToolError(sendingFailureMessage(error.payload), "invalid_input");
      }

      // A document the format it's written in can't hold as given, which a send refuses with `400` too
      if (error instanceof UserFacingError) {
        throw new McpToolError(error.message, "invalid_input");
      }

      // The fields filled in from the company don't make a document a send takes
      if (error instanceof ZodError) {
        throw new McpToolError(issuesMessage(error), "invalid_input");
      }

      throw error;
    }
  },
  input: z.object({
    companyId: z.string().openapi({
      description: "The company sending the document, as list_companies lists it.",
    }),
    doctypeId: sendDocumentBaseShape.doctypeId.openapi({
      description: "The Peppol document type identifier. Leave it out to send in the best format the recipient receives.",
    }),
    document: z.union([z.record(z.string(), z.unknown()), z.string()]).openapi({
      description: "The document, with the fields describe_document returns for its `documentType`; for `xml`, the XML itself.",
    }),
    documentType: documentTypeSchema,
    // The send request's email options, described in fewer words for a model; the request is checked against
    // the send document schema all the same
    email: z
      .object({
        htmlBody: z.string().optional().openapi({
          description: "The email's HTML body. Written for the document when left out.",
        }),
        replyTo: z.string().optional().openapi({
          description: "Where replies go. The document's issuer when left out.",
        }),
        subject: z.string().optional().openapi({
          description: "The email's subject. Written for the document when left out.",
        }),
        to: z.array(z.string()).openapi({
          description: "The addresses to email the document to.",
        }),
        when: z.enum(["always", "on_peppol_failure"]).optional().openapi({
          description: "`always`, or only `on_peppol_failure`, the default, when Peppol can't deliver it.",
        }),
      })
      .optional()
      .openapi({
        description: "Send the document by email too. Required, with `to`, when `recipient` is null.",
      }),
    pdfGeneration: sendDocumentBaseShape.pdfGeneration,
    processId: sendDocumentBaseShape.processId.openapi({
      description: "The Peppol process identifier. Leave it out to use the one the document type and recipient call for.",
    }),
    recipient: sendDocumentBaseShape.recipient.openapi({
      description:
        "The recipient's Peppol address, such as `0208:0123456789`, as find_recipient checks it. Null to send by email only, which needs `email.to`.",
    }),
  }),
  name: "prepare_send",
  operations: ["sendDocument"],
  title: "Prepare a send",
});
