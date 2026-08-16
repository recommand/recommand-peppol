import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import {
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import { normalizePeppolAddress } from "@peppol/utils/parsing/peppol-address";
import {
  DocumentType,
  documentTypeSchema,
  sendDocumentSchema,
} from "@peppol/utils/parsing/send-document";
import { SendingFailure } from "@peppol/utils/pipelines/sending/errors";
import { prepareJsonDocument } from "@peppol/utils/pipelines/sending/prepare-json-document";
import { validateDocument } from "@peppol/utils/pipelines/sending/validate-document";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";

const server = new Server();

// Raw XML has nothing to generate, so it is dropped from the document types
// this endpoint takes. Both halves are derived from the send schema rather than
// spelled out again, so a newly supported document type is accepted here too.
const generateXmlDocumentTypeSchema = documentTypeSchema
  .exclude([DocumentType.XML])
  .openapi({
    description: "The type of document.",
    example: DocumentType.INVOICE,
  });

// The raw XML variant is the only string in the union the send endpoint takes,
// every other document type is an object.
type JsonDocumentVariant = Exclude<
  (typeof sendDocumentSchema.shape.document.options)[number],
  z.ZodString
>;

const jsonDocumentVariants = sendDocumentSchema.shape.document.options.filter(
  (option): option is JsonDocumentVariant => !(option instanceof z.ZodString),
) as [JsonDocumentVariant, JsonDocumentVariant, ...JsonDocumentVariant[]];

const generateXmlDocumentSchema = z.union(jsonDocumentVariants);

// A null recipient means email-only delivery on the send endpoint, which throws
// the generated XML away instead of transmitting or storing it, so there is no
// document to generate for one here.
const generateXmlRecipientSchema = z.string().openapi({
  description: "The Peppol address of the recipient the document is generated for.",
  example: "0208:987654321",
});

// Nothing is delivered here, so the delivery options of the send endpoint have
// no meaning: the body is its document half.
const generateXmlSchema = sendDocumentSchema.omit({ email: true }).extend({
  recipient: generateXmlRecipientSchema,
  documentType: generateXmlDocumentTypeSchema,
  document: generateXmlDocumentSchema,
});

type GenerateXmlContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof generateXmlSchema> };
    out: { json: z.infer<typeof generateXmlSchema> };
  }
>;

const generateXmlResponse = z.object({
  xml: z.string().openapi({
    description: "The generated XML document.",
  }),
  documentType: z.string().openapi({
    description: "The type of the generated document.",
    example: DocumentType.INVOICE,
  }),
  doctypeId: z.string().openapi({
    description: "The document type identifier the document was generated for.",
    example:
      "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  }),
  processId: z.string().openapi({
    description: "The process identifier the document was generated for.",
    example: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  }),
});

const routeDescription = describeRoute({
  operationId: "generateXml",
  description:
    "Generate the XML document that would be sent for the given payload, without sending or storing it. Accepts the same body as the send document endpoint, minus the email delivery options and the raw XML document type, which has nothing to generate. The generated document is validated exactly as it is when sending, so it only comes back if it would be accepted by the Peppol network. Documents generated through this endpoint do not count towards your Recommand subscription usage.",
  summary: "Generate XML",
  tags: ["Sending"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully generated document",
      generateXmlResponse,
    ),
    ...describeErrorResponse(
      400,
      "Invalid document data provided, or the generated document failed validation",
    ),
  },
});

async function generateXmlImplementation(c: GenerateXmlContext) {
  try {
    const input = c.req.valid("json");
    const senderIdentifier = await getSendingCompanyIdentifier(
      c.var.company.id,
    );
    const prepared = await prepareJsonDocument({
      input,
      company: c.var.company,
      senderAddress: `${senderIdentifier.scheme}:${senderIdentifier.identifier}`,
      recipientAddress: normalizePeppolAddress(input.recipient),
      documentId: `draft_${ulid()}`,
      wrapContainer: false,
    });

    // The same gate the send endpoint puts in front of the network, so a
    // document that generates here is one that sends there.
    await validateDocument(prepared.xml);

    // Currently not mentioned in the API docs yet, so we can still roll this back if needed
    if (c.req.header("accept")?.toLowerCase().startsWith("application/xml")) {
      c.header("Content-Type", "application/xml; charset=utf-8");
      return c.body(prepared.xml);
    }

    return c.json(
      actionSuccess({
        xml: prepared.xml,
        documentType: prepared.type,
        doctypeId: prepared.docTypeId,
        processId: prepared.processId,
      }),
    );
  } catch (error) {
    if (error instanceof SendingFailure) {
      return c.json(
        typeof error.payload === "string"
          ? actionFailure(error.payload)
          : actionFailure(error.payload),
        error.status,
      );
    }

    console.error(error);
    return c.json(
      actionFailure(
        error instanceof Error ? error.message : "Failed to generate document",
      ),
      400,
    );
  }
}

const generateXml = server.post(
  "/:companyId/generateXml",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  routeDescription,
  zodValidator("json", generateXmlSchema),
  generateXmlImplementation,
);

export type GenerateXml = typeof generateXml;

export default server;
