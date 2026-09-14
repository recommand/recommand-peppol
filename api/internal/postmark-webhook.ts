import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  applyProviderDeliveryReport,
  deliveryIdFromEmailMetadata,
  EMAIL_DELIVERY_PROVIDER,
  interpretPostmarkWebhook,
} from "@peppol/data/deliveries";

// Postmark reports what became of each message it accepted: a delivery once the
// recipient's mail server took it, a bounce or spam complaint when it did not. A
// document email is sent with its delivery id as message metadata, which every
// report returns, so the report finds the delivery it is about; the message id is
// the fallback. Mail that is not a document delivery carries no such metadata and
// is acknowledged without further ado. Postmark retries any answer but 2xx, so
// only a failure of our own is answered that way.

const server = new Server();

/** The header the shared secret may be sent in, next to basic authentication in the URL. */
const SECRET_HEADER = "x-postmark-webhook-secret";

// Record types that concern a delivery. Opens, clicks and subscription changes are
// acknowledged and ignored, as is anything Postmark adds later.
const DELIVERY_RECORD_TYPES: ReadonlySet<string> = new Set([
  "Delivery",
  "Bounce",
  "SpamComplaint",
]);

const webhookRecordSchema = z
  .object({
    RecordType: z.string(),
    MessageID: z.string().optional(),
    MessageStream: z.string().optional(),
    Metadata: z.record(z.string(), z.unknown()).optional(),
    // Bounce and spam complaint fields.
    ID: z.number().optional(),
    Type: z.string().optional(),
    TypeCode: z.number().optional(),
    Description: z.string().optional(),
    Details: z.string().optional(),
  })
  .passthrough();

function matchesSecret(secret: string, provided: string): boolean {
  const expected = Buffer.from(secret, "utf8");
  const given = Buffer.from(provided, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Whether a request carries the shared secret: as the password of HTTP basic
 * authentication (the username is free, and the secret alone is accepted as the
 * username when no password was given, which is what a URL of the form
 * `https://secret@host/...` sends), or in the secret header.
 */
export function isAuthorizedPostmarkRequest(
  headers: { authorization?: string; secretHeader?: string },
  secret: string
): boolean {
  if (headers.secretHeader && matchesSecret(secret, headers.secretHeader)) {
    return true;
  }
  const authorization = headers.authorization?.trim() ?? "";
  const [scheme, encoded] = authorization.split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) {
    return false;
  }
  let credentials: string;
  try {
    credentials = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = credentials.indexOf(":");
  const username = separator === -1 ? credentials : credentials.slice(0, separator);
  const password = separator === -1 ? "" : credentials.slice(separator + 1);
  return password ? matchesSecret(secret, password) : matchesSecret(secret, username);
}

/** The stored copy of a report leaves out the bounce dump, which can be large. */
function payloadForRecord(record: Record<string, unknown>): Record<string, unknown> {
  const { Content: _content, ...rest } = record;
  return rest;
}

server.post("/postmark", describeRoute({ hide: true }), async (c) => {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("POSTMARK_WEBHOOK_SECRET environment variable is not set");
    return c.json(actionFailure("Webhook secret not configured"), 500);
  }
  if (
    !isAuthorizedPostmarkRequest(
      {
        authorization: c.req.header("authorization"),
        secretHeader: c.req.header(SECRET_HEADER),
      },
      secret
    )
  ) {
    return c.json(actionFailure("Unauthorized"), 401);
  }

  try {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(actionFailure("Invalid webhook payload: not JSON"), 400);
    }
    const parsed = webhookRecordSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Invalid Postmark webhook payload:", parsed.error);
      return c.json(actionFailure("Invalid webhook payload: " + parsed.error.message), 400);
    }
    const record = parsed.data;

    if (!DELIVERY_RECORD_TYPES.has(record.RecordType)) {
      return c.json(actionSuccess({ message: "Record type not processed" }), 200);
    }

    const deliveryId = deliveryIdFromEmailMetadata(record.Metadata);
    if (!deliveryId || !record.MessageID) {
      console.log(
        `Ignoring Postmark ${record.RecordType} for message ${record.MessageID ?? "without id"}: not a document delivery`
      );
      return c.json(actionSuccess({ message: "Not a document delivery" }), 200);
    }

    const interpretation = interpretPostmarkWebhook(record);
    if (!interpretation) {
      return c.json(actionSuccess({ message: "Record type not processed" }), 200);
    }
    if (interpretation.kind === "informational") {
      console.log(
        `Postmark ${record.RecordType} for delivery ${deliveryId} says nothing about its outcome (${interpretation.reason})`
      );
      return c.json(actionSuccess({ message: "Not a delivery outcome" }), 200);
    }

    const outcome = await applyProviderDeliveryReport({
      channel: "email",
      provider: EMAIL_DELIVERY_PROVIDER,
      providerTransactionId: record.MessageID,
      deliveryId,
      // Email has no test network; the flag only travels with a staged report.
      useTestNetwork: false,
      status: interpretation.status,
      failure: interpretation.failure,
      eventId: record.ID !== undefined ? String(record.ID) : null,
      eventType: record.RecordType,
      payload: payloadForRecord(record),
    });
    if (outcome === "staged") {
      console.log(
        `Postmark ${record.RecordType} for delivery ${deliveryId} arrived before the delivery was recorded; it is kept`
      );
    }
    return c.json(actionSuccess({ outcome }), 200);
  } catch (error) {
    console.error("Error processing Postmark webhook:", error);
    return c.json(actionFailure("Unknown error"), 500);
  }
});

export default server;
