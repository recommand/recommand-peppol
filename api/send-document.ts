import {
  describeErrorResponse,
  describeSuccessResponse,
} from "@core/lib/api-docs";
import {
  describeIdempotencyConflictResponse,
  describeIdempotentUnprocessableResponse,
  describeIdempotentValidationErrorResponse,
  idempotencyKeyParameter,
  idempotencyResponseHeaders,
  idempotent,
} from "@core/lib/idempotency";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requirePermission,
  requireTransactionEntitlement,
} from "@peppol/utils/auth-middleware";
import { sendingPipeline } from "@peppol/utils/pipelines/sending";
import { sendDocumentSchema } from "@peppol/utils/parsing/send-document";
import { Server } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { captureSendDocumentRecording } from "@peppol/data/send-document-recording";
import { trackSendDocument } from "@peppol/utils/metrics";
import {
  deliveryChannelSchema,
  deliveryFailureCategorySchema,
  deliveryResponse,
  deliveryStatusResponse,
} from "./documents/shared";

const server = new Server();

const sendDocumentResponse = z.object({
  sentOverPeppol: z.boolean().openapi({
    description:
      "Whether the document was handed over to the Peppol network. False when the document could not be routed or the sending access point refused it, in which case it was delivered by email instead. Handing over is not arrival: see `deliveryStatus` and `deliveries` for whether the recipient's access point acknowledged it.",
    examples: [true],
  }),
  sentOverEmail: z.boolean().openapi({
    description:
      "Whether the document was also sent by email in this request. Email delivery happens when you configure it, either always or only as a fallback when Peppol delivery fails. This field describes the send itself: an email fallback that goes out afterwards, when the access point reports the transmission failed, appears in `deliveries` and in `document.delivery_status_changed` events, not here.",
    examples: [false],
  }),
  emailRecipients: z.array(z.string()).openapi({
    description:
      "The email addresses the document was sent to in this request. Empty when it was not sent by email in this request; an address the mail service refused is left out. Like `sentOverEmail` this describes the send itself; `deliveries` is where every delivery of the document stands, including an email fallback sent later.",
    examples: [[]],
  }),
  teamId: z.string().openapi({
    description: "The ID of the team the document was sent from.",
    examples: ["team_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  companyId: z.string().openapi({
    description: "The ID of the company the document was sent for.",
    examples: ["c_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  id: z.string().openapi({
    description:
      "The Recommand document ID of the stored document. Use it with the documents endpoints to fetch, render or download what was sent.",
    examples: ["doc_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
  peppolMessageId: z.string().nullable().openapi({
    description:
      "The AS4 message ID of the transmission. Null when the document was not transmitted over Peppol, and for playground teams, whose transmissions are simulated.",
    examples: ["b7c2f0a4-3d1e-4a58-9c6d-0f2e8a1b4c73@recommand.eu"],
  }),
  envelopeId: z.string().nullable().openapi({
    description:
      "The envelope ID of the transmission, also known as the SBDH instance identifier (Standard Business Document Header Instance Identifier). Null when the document was not transmitted over Peppol, and for playground teams, whose transmissions are simulated.",
    examples: ["9f1b3c7e-52a4-4d68-8b0f-6c9d2e4a17b5"],
  }),
  deliveryStatus: deliveryStatusResponse,
  deliveries: z.array(deliveryResponse).openapi({
    description:
      "Where the document stands with each recipient: one entry per channel and address it was sent to. A Peppol delivery is `delivered` once the recipient's access point acknowledged the document and `pending` while the sending access point has not yet reported the outcome; an email delivery is `pending` once the mail service accepted the message and becomes `delivered` when the recipient's mail server took it or `failed` when it bounced. In a playground, an email to an address that is not one of the team's members is simulated and `delivered` straight away. Later changes arrive as `document.delivery_status_changed` webhook events.",
  }),
}).openapi({
  description: "The sent document: its ID, the channels it went out over and to whom, and the state of each delivery.",
});

const sendDocumentFailureResponse = z.object({
  deliveryFailure: z.object({
    category: deliveryFailureCategorySchema.openapi({ examples: ["validation"] }),
    channel: deliveryChannelSchema.openapi({
      description: "The channel whose failure the category describes.",
      examples: ["peppol"],
    }),
  }).optional().openapi({
    description:
      "Why the Peppol delivery failed. Absent when the document was only to be sent by email, or when the send failed for another reason after a channel was tried.",
  }),
  outcomeUnknown: z.boolean().optional().openapi({
    description:
      "Set on every `422` of a failed send, and absent on the `422` with code `idempotency_conflict`, which is about the `Idempotency-Key` rather than the send. Whether a channel may have delivered the document although the request failed: the connection to the access point was lost or it didn't say how the transmission went, the mail service didn't confirm an email, or the send failed on Recommand's side after a channel was tried. When true, the document may have been delivered, and after a failure on Recommand's side it may have been stored as well: check the company's documents and with the recipient before sending it again.",
    examples: [false],
  }),
});

const sendDocumentParamSchema = z.object({
  companyId: z.string().openapi({
    description:
      "The ID of the company sending the document. The document is sent from this company's Peppol identifier.",
    examples: ["c_01JQZ8X0M4T7RB6K9V2NDHW3PA"],
  }),
});

const sendDocumentSuccess = describeSuccessResponse("Successfully sent document", sendDocumentResponse);

const routeDescription = describeRoute({
  operationId: "sendDocument",
  description:
    "Send a document to a customer over the Peppol network, by email, or both. The document type identifier and process are resolved against the recipient unless you name both yourself. The document is stored under the company and returned document ID, and it counts towards your subscription usage. When Peppol delivery fails and no email fallback applies, the request fails with a 422.",
  summary: "Send Document",
  tags: ["Sending"],
  parameters: [idempotencyKeyParameter],
  responses: {
    200: { ...sendDocumentSuccess[200], headers: idempotencyResponseHeaders },
    ...describeIdempotentValidationErrorResponse("Invalid document data provided, or an invalid `Idempotency-Key` (code `invalid_idempotency_key`)"),
    ...describeErrorResponse(401, "Unauthorized"),
    ...describeIdempotencyConflictResponse(),
    ...describeIdempotentUnprocessableResponse(
      "Recipient could not be reached and no email fallback was configured or possible, or the send failed after a channel was tried. The body carries `deliveryFailure` with the channel and the failure category, the same category a later `document.delivery_status_changed` event would carry, and `outcomeUnknown`, which says whether the document may have been delivered all the same. Also answered, with code `idempotency_conflict`, when the `Idempotency-Key` was already used for a different request.",
      sendDocumentFailureResponse,
    ),
    ...describeErrorResponse(
      500,
      "The send failed on Recommand's side before the document was handed to any channel. Nothing went out, so the same request can be sent again, under the same `Idempotency-Key` too.",
    ),
  },
});

// Both routes send the same way, so they share a scope: a key used on one can't send again through the other
const sendOnce = idempotent({
  documentationUrl: "https://docs.recommand.eu/docs/sending-invoices#retry-safely",
  scope: (c) => `peppol.send_document:${c.req.param("companyId")}`,
});

// Mounted ahead of the routes rather than as their first handler, which keeps each route within the
// number of handlers Hono types; it still runs first, so authentication and validation count too
server.use("/:companyId/sendDocument", trackSendDocument);
server.use("/:companyId/send", trackSendDocument);

const sendDocument = server.post(
  "/:companyId/sendDocument",
  requireIntegrationSupportedCompanyAccess(),
  requirePermission("exchange.documents.send"),
  requireTransactionEntitlement(),
  requireCompanyVerificationForStrictTeams(),
  describeRoute({ hide: true }),
  captureSendDocumentRecording,
  zodValidator("param", sendDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  sendOnce,
  sendingPipeline,
);

const sendDocumentMinimal = server.post(
  "/:companyId/send",
  requireIntegrationSupportedCompanyAccess(),
  requirePermission("exchange.documents.send"),
  requireTransactionEntitlement(),
  requireCompanyVerificationForStrictTeams(),
  routeDescription,
  captureSendDocumentRecording,
  zodValidator("param", sendDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  sendOnce,
  sendingPipeline,
);

export type SendDocument = typeof sendDocument | typeof sendDocumentMinimal;

export default server;
