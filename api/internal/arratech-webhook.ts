import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@recommand/db";
import { transmittedDocuments } from "@peppol/db/schema";
import { UserFacingError } from "@peppol/utils/util";
import { fetchArratech, getArratechConfig } from "@peppol/data/at/client";
import { receivingPipeline } from "@peppol/utils/pipelines/receiving";
import { extractStandardBusinessDocumentPayload } from "@peppol/utils/sbdh";

const server = new Server();

function matchesSignature(secret: string, rawBody: string, signature: string): boolean {
  const hmac = createHmac("sha256", secret);
  const expectedSignature = hmac.update(rawBody).digest("hex");

  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  const providedSignatureBuffer = Buffer.from(signature, "utf8");

  return (
    expectedSignatureBuffer.length === providedSignatureBuffer.length &&
    timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer)
  );
}

// The transaction's apId tells us which of our configured access points (and
// therefore which network) it belongs to.
function resolveUseTestNetwork(apId: string): boolean | null {
  for (const useTestNetwork of [false, true]) {
    try {
      if (getArratechConfig(useTestNetwork).apRef === apId) {
        return useTestNetwork;
      }
    } catch {
      // Network not configured in this environment
    }
  }
  return null;
}

server.post(
  "/arratech",
  describeRoute({ hide: true }),
  async (c) => {
    console.log("Received Arratech webhook");
    const webhookSecret = process.env.ARRATECH_WEBHOOK_SECRET;
    const testWebhookSecret = process.env.ARRATECH_TEST_WEBHOOK_SECRET;
    if (!webhookSecret && !testWebhookSecret) {
      console.error("ARRATECH_WEBHOOK_SECRET environment variable is not set");
      return c.json(actionFailure("Webhook secret not configured"), 500);
    }

    try {
      const rawBody = await c.req.raw.clone().text();
      const signature = c.req.header("x-arratech-webhook-sign");

      if (!signature) {
        return c.json(actionFailure("Missing signature"), 401);
      }

      const matchesProductionSecret =
        !!webhookSecret && matchesSignature(webhookSecret, rawBody, signature);
      const matchesTestSecret =
        !!testWebhookSecret && matchesSignature(testWebhookSecret, rawBody, signature);
      if (!matchesProductionSecret && !matchesTestSecret) {
        return c.json(actionFailure("Invalid signature"), 401);
      }

      const arratechWebhookSchema = z.object({
        id: z.string(),
        eventType: z.string(),
        payload: z.unknown(),
      });

      const parseResult = arratechWebhookSchema.safeParse(JSON.parse(rawBody));
      if (!parseResult.success) {
        console.error("Invalid webhook payload:", parseResult.error);
        return c.json(actionFailure("Invalid webhook payload: " + parseResult.error.message), 400);
      }

      if (parseResult.data.eventType !== "transaction.received") {
        return c.json(actionSuccess({ message: "Event type not processed" }), 200);
      }

      const transactionPayloadSchema = z.object({
        id: z.string(),
        apId: z.string(),
        senderId: z.string(),
        receiverId: z.string(),
        docTypeId: z.string(),
        processId: z.string(),
        senderCountry: z.string().optional(),
        docInstanceId: z.string().optional(),
      });

      const payloadResult = transactionPayloadSchema.safeParse(parseResult.data.payload);
      if (!payloadResult.success) {
        console.error("Invalid transaction payload:", payloadResult.error);
        return c.json(actionFailure("Invalid transaction payload: " + payloadResult.error.message), 400);
      }

      const payload = payloadResult.data;

      const useTestNetwork = resolveUseTestNetwork(payload.apId);
      if (useTestNetwork === null) {
        console.warn("Ignoring Arratech webhook for unknown access point:", payload.apId);
        return c.json(actionSuccess({ message: "Unknown access point" }), 200);
      }

      // The signature must come from the webhook secret belonging to the same
      // network as the transaction's access point.
      if (useTestNetwork ? !matchesTestSecret : !matchesProductionSecret) {
        return c.json(actionFailure("Signature does not match the access point's network"), 401);
      }

      const existingDocument = await db
        .select({ id: transmittedDocuments.id })
        .from(transmittedDocuments)
        .where(
          and(
            eq(transmittedDocuments.apTransactionId, payload.id),
            eq(transmittedDocuments.direction, "incoming")
          )
        )
        .limit(1);
      if (existingDocument.length > 0) {
        return c.json(actionSuccess({ message: "Already processed" }), 200);
      }

      const config = getArratechConfig(useTestNetwork);
      const response = await fetchArratech(
        `/orgs/${config.orgId}/transactions/${payload.id}/business_document`,
        { useTestNetwork }
      );
      if (!response.ok) {
        console.error("Failed to download Arratech business document:", response.status);
        return c.json(actionFailure("Failed to download business document"), 502);
      }

      const documentPayload = extractStandardBusinessDocumentPayload(
        await response.text()
      );
      let body: string | Blob;
      let contentType: string;
      if (documentPayload.kind === "binary") {
        contentType = documentPayload.mimeType;
        body = new Blob([new Uint8Array(documentPayload.content)], { type: contentType });
      } else {
        contentType = "application/xml";
        body = documentPayload.xml;
      }

      await receivingPipeline({
        senderId: payload.senderId,
        receiverId: payload.receiverId,
        docTypeId: payload.docTypeId,
        processId: payload.processId,
        countryC1: payload.senderCountry ?? "",
        body,
        contentType,
        useTestNetwork,
        sbdhInstanceIdentifier: payload.docInstanceId ?? null,
        as4MessageId: null,
        as4ConversationId: null,
        apTransactionId: payload.id,
      });

      return c.json(actionSuccess(), 200);
    } catch (error) {
      console.error("Error processing Arratech webhook:", error);
      if (error instanceof UserFacingError) {
        return c.json(actionFailure(error), 400);
      }
      return c.json(actionFailure("Unknown error"), 500);
    }
  }
);

export default server;
