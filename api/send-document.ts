import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
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
      sendDocumentResponse,
    ),
    ...describeErrorResponse(400, "Invalid document data provided"),
    ...describeErrorResponse(
      422,
      "Recipient could not be reached and no email fallback was configured or possible",
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
  zodValidator("json", sendDocumentSchema),
  sendingPipeline,
);

export type SendDocument = typeof sendDocument | typeof sendDocumentMinimal;

export default server;
