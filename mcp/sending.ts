import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import "zod-openapi/extend";
import { createSchema } from "zod-openapi";
import type { AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { McpToolError, registerTool } from "@core/lib/mcp/tools";
import type { Company } from "@peppol/data/companies";
import { getCompanyById } from "@peppol/data/companies";
import type { PreparedSend, SendOutcome } from "@peppol/data/prepared-sends";
import { createPreparedSend, getPreparedSend, getSendOutcome } from "@peppol/data/prepared-sends";
import { captureSendDocumentRecording } from "@peppol/data/send-document-recording";
import type { ExtendedTeam } from "@peppol/data/teams";
import { getExtendedTeam } from "@peppol/data/teams";
import { checkPeppolEntitlement, PEPPOL_ENTITLEMENTS } from "@peppol/lib/entitlements";
import { documentDetails } from "@peppol/mcp/document-details";
import { requireCompanyVerificationForStrictTeams, requireTransactionEntitlement } from "@peppol/utils/auth-middleware";
import { trackSendDocument } from "@peppol/utils/metrics";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import {
  documentSendSchema,
  documentTypeSchema,
  sendDocumentBaseShape,
  sendDocumentSchema,
} from "@peppol/utils/parsing/send-document";
import { sendingPipeline } from "@peppol/utils/pipelines/sending";
import { SendingFailure } from "@peppol/utils/pipelines/sending/errors";
import { sendOnce } from "@peppol/utils/pipelines/sending/idempotency";
import { prepareSend } from "@peppol/utils/pipelines/sending/prepare-send";
import { requiresCompanyVerification } from "@peppol/utils/playground";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { UserFacingError } from "@peppol/utils/util";
import { createErrorHandler } from "@recommand/lib/error-handler";
import { zodValidator } from "@recommand/lib/zod-validator";

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
    "Check a document before sending it, without sending it: it's written, routed to the recipient and validated the way a send would. Call describe_document first for the fields `document` takes. Returns a summary to show the user, and a `handle` that send_document sends exactly this document with, for 15 minutes. Ask the user to approve the summary before calling send_document.",
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

type SendBindings = {
  Bindings: {
    company: Company;
    request: Context<AuthenticatedUserContext>;
    team: ExtendedTeam;
  };
};

// What authenticating the request to the MCP server set, so a send acts, and is audited, as that credential
const CREDENTIAL_VARIABLES = ["apiKey", "authenticationMethod", "grant", "language", "session", "teamId", "user"];

// The headers the audit log reads who sent from
const AUDITED_HEADERS = ["cf-connecting-ip", "cf-ray", "user-agent", "x-correlation-id", "x-forwarded-for", "x-real-ip", "x-request-id"];

const actAsTheCall: MiddlewareHandler<SendBindings> = async (c, next) => {
  for (const variable of CREDENTIAL_VARIABLES) {
    c.set(variable as never, c.env.request.get(variable as never) as never);
  }

  c.set("company" as never, c.env.company as never);
  c.set("team" as never, c.env.team as never);
  await next();
};

/**
 * The send routes' chain without their authentication, which the MCP server did for the call: the same
 * metrics, checks, idempotency and pipeline. Sending through the routes themselves isn't an option, since
 * a token for the MCP server doesn't work on the API.
 */
const sender = new Hono<SendBindings>();
sender.post(
  "/mcp/send_document/:companyId",
  // First, as on the routes, so the checks count too; it reads the team `actAsTheCall` sets once the send is done
  trackSendDocument as unknown as MiddlewareHandler<SendBindings>,
  actAsTheCall,
  ...([
    requireTransactionEntitlement(),
    requireCompanyVerificationForStrictTeams(),
    captureSendDocumentRecording,
    zodValidator("json", sendDocumentSchema),
    sendOnce,
    sendingPipeline,
  ] as unknown as MiddlewareHandler<SendBindings>[])
);
sender.onError(createErrorHandler({ isDev: false }));

/** The code a refused send comes back with, when its answer doesn't name one, such as the idempotency conflicts do. */
const failureCode = (status: number) => {
  if (status === 400) {
    return "invalid_input";
  }

  if (status === 401 || status === 403) {
    return "not_allowed";
  }

  if (status === 404) {
    return "not_found";
  }

  return status === 422 ? "delivery_failed" : "send_failed";
};

const OUTCOME_UNKNOWN =
  "It's unknown whether the document went out, so this handle won't send it again. Check whether the recipient got it before preparing it again.";

/** A send's answer, without the fields every answer of the API carries. */
const answerOf = ({ code: _, errors: __, success: ___, ...answer }: Record<string, unknown>) => answer;

/** What the model is told of a send the API answered with a failure, whether just now or replayed from its key. */
const sendFailure = (preparedSend: PreparedSend, status: number, { code, errors, ...body }: Record<string, any>) => {
  const message = sendingFailureMessage(errors ?? "The document couldn't be sent.");
  // A send that failed after a channel was tried may have gone out all the same, so the model isn't told to
  // correct the document and prepare it again
  if (body.outcomeUnknown) {
    return new McpToolError(`${message}\n${OUTCOME_UNKNOWN}`, code ?? failureCode(status));
  }

  // The recipient was asked for its format when the document was prepared, and no longer receives it
  if (preparedSend.fixedRoute && body.deliveryFailure?.category === "document_not_supported") {
    return new McpToolError(`${message}\nThe recipient no longer receives the document as it was prepared. Prepare it again.`, "delivery_failed");
  }

  // A send that fails on the server's side answers `500`, which comes back as `send_failed`. A `400` that
  // isn't about the request's fields refuses a document that was checked when it was prepared, so something
  // changed since, such as the company's identifiers: neither correcting the document nor sending it again
  // helps, so the model reports the refusal to the user
  if (!code && status === 400 && !body.invalidInputDetails) {
    return new McpToolError(
      `${message}\nThe document was checked when it was prepared, so something changed since. Tell the user, rather than sending it again.`,
      "send_refused"
    );
  }

  return new McpToolError(message, code ?? failureCode(status));
};

/**
 * What a handle's send came to, as the idempotency key it went out under holds it: the response the first send
 * ended with, success or failure, a send still running, or one that ended without a response and may have gone
 * out, after what went wrong when there's a `failure`.
 */
const answerFromKey = (preparedSend: PreparedSend, key: SendOutcome, failure?: string) => {
  if (key.status === "completed") {
    const answer = JSON.parse(key.responseBody ?? "{}");
    const status = key.responseStatus ?? 200;
    if (status >= 400) {
      throw sendFailure(preparedSend, status, answer);
    }

    return answerOf(answer);
  }

  if (key.status === "in_progress" && !key.stale) {
    throw new McpToolError("The send with this handle is still running. Call send_document again in a few seconds for its answer.", "idempotency_in_progress");
  }

  throw new McpToolError(failure ? `${failure}\n${OUTCOME_UNKNOWN}` : OUTCOME_UNKNOWN, "idempotency_outcome_unknown");
};

registerTool({
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true, readOnlyHint: false },
  description:
    "Send a document prepare_send prepared, exactly as it was prepared, once the user approved its summary, within 15 minutes. A repeat with the same handle doesn't send it again, but returns the first send's answer.",
  handler: async ({ request, team }, { handle }) => {
    const preparedSend = await getPreparedSend(team.id, handle);
    if (!preparedSend) {
      throw new McpToolError(`There's no prepared document ${handle} in this team.`, "not_found");
    }

    // Once it expired, a handle only hands back what its send came to, and never sends again: it's read from
    // the key rather than asked of the send, so nothing is sent, also when that key is freed or expires meanwhile
    if (preparedSend.expiresAt <= new Date()) {
      const key = await getSendOutcome(preparedSend);
      if (!key) {
        throw new McpToolError("This prepared document expired. Prepare it again with prepare_send.", "expired");
      }

      return answerFromKey(preparedSend, key);
    }

    const [company, extendedTeam] = await Promise.all([getCompanyById(preparedSend.companyId), getExtendedTeam(team.id)]);
    if (!company || !extendedTeam) {
      throw new McpToolError(`The company ${preparedSend.companyId} is gone.`, "not_found");
    }

    const headers = Object.fromEntries(
      AUDITED_HEADERS.flatMap((header) => {
        const value = request.req.header(header);

        return value ? [[header, value]] : [];
      })
    );
    const response = await sender.request(
      `/mcp/send_document/${company.id}`,
      {
        body: JSON.stringify(preparedSend.input),
        headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": preparedSend.id },
        method: "POST",
      },
      { company, request, team: extendedTeam }
    );
    const body = await response.json();
    if (response.ok) {
      return answerOf(body);
    }

    // What the handle's key holds says more than a refusal without a code, when this call was refused before
    // it got to the key: the first send's answer, or one that's still running or may have gone out
    const key = body.code ? null : await getSendOutcome(preparedSend);
    if (key) {
      return answerFromKey(preparedSend, key, sendingFailureMessage(body.errors ?? "The document couldn't be sent."));
    }

    throw sendFailure(preparedSend, response.status, body);
  },
  input: z.object({
    handle: z.string().openapi({
      description: "The handle prepare_send returned for the document.",
    }),
  }),
  name: "send_document",
  operations: ["sendDocument"],
  title: "Send a document",
});
