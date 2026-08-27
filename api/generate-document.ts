import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { getRecipientCapabilities } from "@peppol/data/recipient-capabilities";
import {
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import { normalizePeppolAddress } from "@peppol/utils/parsing/peppol-address";
import {
  DocumentType,
  documentRequestSchema,
  documentTypeSchema,
  sendDocumentBaseShape,
} from "@peppol/utils/parsing/send-document";
import { SendingFailure } from "@peppol/utils/pipelines/sending/errors";
import { assertFranceRegulatedSendingSupported } from "@peppol/utils/pipelines/sending/france-regulated-guard";
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
// this endpoint takes. The list is derived from the send schema rather than
// spelled out again, so a newly supported document type is accepted here too.
const generateDocumentTypes = documentTypeSchema.options.filter(
  (type): type is Exclude<DocumentType, typeof DocumentType.XML> =>
    type !== DocumentType.XML,
);

// Nothing is delivered here, so the delivery options of the send endpoint have
// no meaning, and a null recipient means email-only delivery there, which throws
// the generated XML away instead of transmitting or storing it: there is no
// document to generate for one here.
const { email: _email, ...generateBaseShape } = {
  ...sendDocumentBaseShape,
  recipient: z.string().openapi({
    description:
      "The Peppol address of the recipient the document is generated for.",
    example: "0208:987654321",
  }),
};

const generateSchema = documentRequestSchema(
  generateBaseShape,
  generateDocumentTypes,
);

type GenerateContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof generateSchema> };
    out: { json: z.infer<typeof generateSchema> };
  }
>;

const generateResponse = z.object({
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
  operationId: "generate",
  description:
    "Generate the XML document that would be written for the given payload, without sending or storing it. Accepts the same body as the send document endpoint, minus the email delivery options and the raw XML document type. The document type identifier and process are resolved against the recipient exactly as they are when sending, so leaving them out returns the document written as the format the recipient is registered to receive; naming both yourself skips that lookup, again exactly as sending does. This endpoint does not check that the recipient can receive the document. The generated document is validated exactly as it is when sending. Documents generated through this endpoint do not count towards your Recommand subscription usage.",
  summary: "Generate Document",
  tags: ["Sending"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully generated document",
      generateResponse,
    ),
    ...describeErrorResponse(
      400,
      "Invalid document data provided, or the generated document failed validation",
    ),
  },
});

async function generateImplementation(c: GenerateContext) {
  try {
    const input = c.req.valid("json");
    const company = c.var.company;
    const team = c.var.team;
    const isPlayground = team.isPlayground ?? false;
    const useTestNetwork = team.useTestNetwork ?? false;
    const senderIdentifier = await getSendingCompanyIdentifier(company.id);
    const recipientAddress = normalizePeppolAddress(input.recipient);

    // The same lookup the send endpoint does, under the same condition, so the
    // document comes back written as the format the recipient would have received it
    // in rather than as the first one the registry declares. A caller that names both
    // leaves nothing to decide and is taken at its word, so the request is skipped.
    // The lookup only chooses a format here: a recipient it cannot find, or finds
    // nothing usable on, falls back to the default format rather than failing.
    const recipientCapabilities =
      recipientAddress !== null && (!input.doctypeId || !input.processId)
        ? await getRecipientCapabilities({
            recipientAddress,
            isPlayground,
            useTestNetwork,
            teamId: team.id,
          })
        : null;

    const prepared = await prepareJsonDocument({
      input,
      company,
      senderAddress: `${senderIdentifier.scheme}:${senderIdentifier.identifier}`,
      recipientAddress,
      documentId: `draft_${ulid()}`,
      wrapContainer: false,
      isPlayground,
      recipientCapabilities,
    });

    // The guard sending applies to the company's own setup: a French regulated
    // combination this company cannot send is not one to write a document for either.
    assertFranceRegulatedSendingSupported({
      docTypeId: prepared.docTypeId,
      processId: prepared.processId,
      company,
      isPlayground,
    });

    // A routing failure is deliberately not an error here, and neither is a recipient
    // that could not be looked up at all. Whether the recipient can take delivery is
    // the Verify Document Support endpoint's question: answering half of it would be
    // worse than leaving it there, since an address registered on the network for
    // nothing usable is the rarer case, and the unregistered address it would still
    // let through is the common one.
    //
    // The same validation the send endpoint runs, so a document that comes back is one
    // the network would accept, whoever it is eventually addressed to.
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

const generateDocument = server.post(
  "/:companyId/generate",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  routeDescription,
  zodValidator("json", generateSchema),
  generateImplementation,
);

export type GenerateDocument = typeof generateDocument;

export default server;
