import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@recommand/db";
import { transmittedDocuments } from "@peppol/db/schema";
import { UserFacingError } from "@peppol/utils/util";
import { downloadBusinessDocument } from "@peppol/data/at/ap";
import { getArratechConfig } from "@peppol/data/at/client";
import { recordProviderSentTransaction } from "@peppol/data/provider-sent";
import { receivingPipeline } from "@peppol/utils/pipelines/receiving";

const server = new Server();

const RECEIVED_EVENT_TYPE = "transaction.received";
const SENT_EVENT_TYPE = "transaction.sent";

// The access point every company on this provider sends through, and therefore the
// provider that reported the transactions this webhook queues.
const ARRATECH_ACCESS_POINT_PROVIDER = "at-shared-ap-fr" as const;

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
// therefore which network) it belongs to. Both networks are checked so that an
// access point shared by a misconfiguration is reported as ambiguous instead of
// defaulting to production.
function resolveUseTestNetwork(apId: string): boolean | null {
  const matches: boolean[] = [];
  for (const useTestNetwork of [false, true]) {
    try {
      if (getArratechConfig(useTestNetwork).apRef === apId) {
        matches.push(useTestNetwork);
      }
    } catch {
      // Network not configured in this environment
    }
  }

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.error(
        "Ambiguous Arratech access point:",
        apId,
        "- ARRATECH_AP_REF and ARRATECH_TEST_AP_REF must be different values"
      );
    }
    return null;
  }

  return matches[0]!;
}

async function findTransmittedDocument(
  apTransactionId: string,
  direction: "incoming" | "outgoing"
): Promise<{ id: string } | undefined> {
  return await db
    .select({ id: transmittedDocuments.id })
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.apTransactionId, apTransactionId),
        eq(transmittedDocuments.direction, direction)
      )
    )
    .limit(1)
    .then((rows) => rows[0]);
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

      const eventType = parseResult.data.eventType;
      if (eventType !== RECEIVED_EVENT_TYPE && eventType !== SENT_EVENT_TYPE) {
        console.log("Ignoring Arratech webhook event type:", eventType);
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
        transactionStatus: z.string().optional(),
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

      if (eventType === SENT_EVENT_TYPE) {
        // The event fires on successful delivery, but the status is checked when it is
        // reported so a failed transaction is never stored as a sent document.
        if (
          payload.transactionStatus &&
          payload.transactionStatus.toUpperCase() !== "COMPLETED"
        ) {
          return c.json(actionSuccess({ message: "Transaction not completed" }), 200);
        }

        // Arratech reports every outbound transaction, including the ones our own
        // sending pipeline created. Those are recognised by the envelope claim their
        // send wrote before the document ever reached Arratech, so only the documents
        // Arratech sent on our behalf are recorded here (see data/provider-sent).
        const outcome = await recordProviderSentTransaction({
          c,
          accessPointProvider: ARRATECH_ACCESS_POINT_PROVIDER,
          apTransactionId: payload.id,
          useTestNetwork,
          senderId: payload.senderId,
          receiverId: payload.receiverId,
          docTypeId: payload.docTypeId,
          processId: payload.processId,
          senderCountry: payload.senderCountry ?? null,
          docInstanceId: payload.docInstanceId ?? null,
        });

        return c.json(actionSuccess({ outcome }), 200);
      }

      if (await findTransmittedDocument(payload.id, "incoming")) {
        return c.json(actionSuccess({ message: "Already processed" }), 200);
      }

      const document = await downloadBusinessDocument({
        transactionId: payload.id,
        useTestNetwork,
      });
      if (!document) {
        return c.json(actionFailure("Failed to download business document"), 502);
      }

      await receivingPipeline({
        senderId: payload.senderId,
        receiverId: payload.receiverId,
        docTypeId: payload.docTypeId,
        processId: payload.processId,
        countryC1: payload.senderCountry ?? "",
        body: document.body,
        contentType: document.contentType,
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
