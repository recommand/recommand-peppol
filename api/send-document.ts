import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
  describeValidationErrorResponse,
} from "@core/lib/api-docs";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
} from "@peppol/utils/auth-middleware";
import { sendingPipeline } from "@peppol/utils/pipelines/sending";
import { sendDocumentSchema } from "@peppol/utils/parsing/send-document";
import { Server } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { captureSendDocumentRecording } from "@peppol/data/send-document-recording";
import { trackSendDocument } from "@peppol/utils/metrics";
import { deliveryResponse, deliveryStatusResponse } from "./documents/shared";

const server = new Server();

const sendDocumentResponse = z.object({
  sentOverPeppol: z.boolean().openapi({
    description:
      "Whether the document was handed over to the Peppol network. False when the document could not be routed or the sending access point refused it, in which case it was delivered by email instead. Handing over is not arrival: see `deliveryStatus` and `deliveries` for whether the recipient's access point acknowledged it.",
    example: true,
  }),
  sentOverEmail: z.boolean().openapi({
    description:
      "Whether the document was also sent by email in this request. Email delivery happens when you configure it, either always or only as a fallback when Peppol delivery fails. This field describes the send itself: an email fallback that goes out afterwards, when the access point reports the transmission failed, appears in `deliveries` and in `document.delivery_status_changed` events, not here.",
    example: false,
  }),
  emailRecipients: z.array(z.string()).openapi({
    description:
      "The email addresses the document was sent to in this request. Empty when it was not sent by email in this request; an address the mail service refused is left out. Like `sentOverEmail` this describes the send itself; `deliveries` is where every delivery of the document stands, including an email fallback sent later.",
    example: [],
  }),
  teamId: z.string().openapi({
    description: "The ID of the team the document was sent from.",
    example: "team_01JQZ8X0M4T7RB6K9V2NDHW3PA",
  }),
  companyId: z.string().openapi({
    description: "The ID of the company the document was sent for.",
    example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
  }),
  id: z.string().openapi({
    description:
      "The Recommand document ID of the stored document. Use it with the documents endpoints to fetch, render or download what was sent.",
    example: "doc_01JQZ8X0M4T7RB6K9V2NDHW3PA",
  }),
  peppolMessageId: z.string().nullable().openapi({
    description:
      "The AS4 message ID of the transmission. Null when the document was not transmitted over Peppol, and for playground teams, whose transmissions are simulated.",
    example: "b7c2f0a4-3d1e-4a58-9c6d-0f2e8a1b4c73@recommand.eu",
  }),
  envelopeId: z.string().nullable().openapi({
    description:
      "The envelope ID of the transmission, also known as the SBDH instance identifier (Standard Business Document Header Instance Identifier). Null when the document was not transmitted over Peppol, and for playground teams, whose transmissions are simulated.",
    example: "9f1b3c7e-52a4-4d68-8b0f-6c9d2e4a17b5",
  }),
  deliveryStatus: deliveryStatusResponse,
  deliveries: z.array(deliveryResponse).openapi({
    description:
      "Where the document stands with each recipient: one entry per channel and address it was sent to. A Peppol delivery is `delivered` once the recipient's access point acknowledged the document and `pending` while the sending access point has not yet reported the outcome; email deliveries are `pending` once the mail was accepted for delivery. Later changes arrive as `document.delivery_status_changed` webhook events.",
  }),
});

const sendDocumentParamSchema = z.object({
  companyId: z.string().openapi({
    description:
      "The ID of the company sending the document. The document is sent from this company's Peppol identifier.",
    example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
  }),
});

const routeDescription = describeRoute({
  operationId: "sendDocument",
  description:
    "Send a document to a customer over the Peppol network, by email, or both. The document type identifier and process are resolved against the recipient unless you name both yourself. The document is stored under the company and returned document ID, and it counts towards your subscription usage. When Peppol delivery fails and no email fallback applies, the request fails with a 422 and nothing is stored.",
  summary: "Send Document",
  tags: ["Sending"],
  responses: {
    ...describeSuccessResponseWithZod(
      "Successfully sent document",
      sendDocumentResponse,
    ),
    ...describeValidationErrorResponse("Invalid document data provided"),
    ...describeErrorResponse(
      422,
      "Recipient could not be reached and no email fallback was configured or possible. The body carries `deliveryFailure` with the channel and the failure category, the same category a later `document.delivery_status_changed` event would carry.",
    ),
  },
});

const sendDocument = server.post(
  "/:companyId/sendDocument",
  trackSendDocument,
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  describeRoute({ hide: true }),
  captureSendDocumentRecording,
  zodValidator("param", sendDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  sendingPipeline,
);

const sendDocumentMinimal = server.post(
  "/:companyId/send",
  trackSendDocument,
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  routeDescription,
  captureSendDocumentRecording,
  zodValidator("param", sendDocumentParamSchema),
  zodValidator("json", sendDocumentSchema),
  sendingPipeline,
);

export type SendDocument = typeof sendDocument | typeof sendDocumentMinimal;

export default server;
