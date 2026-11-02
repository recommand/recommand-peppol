import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";
import { type ImportFileUpload, sha256Hex } from "@peppol/data/imports/files";
import { acceptImport, findEmailImport } from "@peppol/data/imports/imports";
import { kickImportWorker } from "@peppol/data/imports/worker";
import { findInboundAddressByEmail, type InboundAddress } from "@peppol/data/inbound-addresses";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import { detectFileKind, MEDIA_TYPES, xmlFormat, xmlText } from "@peppol/utils/pipelines/intake/file-kind";
import { isAuthorizedPostmarkRequest } from "./postmark-webhook";

// Postmark posts every email sent to the inbound domain here. An address that does not
// exist, is disabled or is deleted gets 403, which makes Postmark stop retrying. A
// message that was already received gets 200 and nothing more. Anything else is stored
// as an import, which the worker processes: this handler only stores, because Postmark
// waits for an answer for a limited time. A failure of our own gets 500, and Postmark
// retries it.

const server = new Server();

const SECRET_HEADER = "x-postmark-webhook-secret";

const addressSchema = z.object({ Email: z.string(), Name: z.string().optional() }).passthrough();

const inboundSchema = z
  .object({
    MessageID: z.string().min(1),
    OriginalRecipient: z.string().optional(),
    ToFull: z.array(addressSchema).optional(),
    CcFull: z.array(addressSchema).optional(),
    FromFull: addressSchema.optional(),
    From: z.string().optional(),
    Subject: z.string().optional(),
    Date: z.string().optional(),
    Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
    Attachments: z
      .array(z.object({ Name: z.string().optional(), Content: z.string(), ContentType: z.string().optional() }).passthrough())
      .optional(),
    RawEmail: z.string().optional(),
  })
  .passthrough();

type InboundEmail = z.infer<typeof inboundSchema>;

async function findAddress(email: InboundEmail): Promise<InboundAddress | null> {
  const recipients = [
    email.OriginalRecipient,
    ...(email.ToFull ?? []).map((recipient) => recipient.Email),
    ...(email.CcFull ?? []).map((recipient) => recipient.Email),
  ].filter((recipient): recipient is string => !!recipient);
  for (const recipient of recipients) {
    const address = await findInboundAddressByEmail(recipient);
    if (address) {
      return address;
    }
  }
  return null;
}

function header(email: InboundEmail, name: string): string | null {
  return email.Headers?.find((entry) => entry.Name.toLowerCase() === name.toLowerCase())?.Value ?? null;
}

/** The mail authentication results the mail provider recorded, as far as the headers say. */
function authentication(email: InboundEmail) {
  const spf = header(email, "Received-SPF")?.trim().split(/\s+/)[0]?.toLowerCase() ?? null;
  const dkim = header(email, "Authentication-Results")?.match(/dkim=(\w+)/i)?.[1]?.toLowerCase() ?? null;
  return { spf, dkim };
}

function receivedAt(email: InboundEmail): string | null {
  const date = email.Date ? new Date(email.Date) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/** The files to store: the MIME source, and each attachment that is a PDF or XML document. */
function emailFiles(email: InboundEmail): ImportFileUpload[] {
  const provenance = { kind: "source" as const };
  const uploads: ImportFileUpload[] = [];
  if (email.RawEmail) {
    uploads.push({
      filename: "message.eml",
      mediaType: "message/rfc822",
      format: "mime",
      bytes: Buffer.from(email.RawEmail, "utf8"),
      provenance,
    });
  }
  for (const [index, attachment] of (email.Attachments ?? []).entries()) {
    const bytes = Buffer.from(attachment.Content, "base64");
    // What a file is comes from its content, not from the declared content type.
    const kind = detectFileKind(bytes);
    if (!kind) {
      continue;
    }
    uploads.push({
      filename: attachment.Name || `attachment-${index + 1}.${kind}`,
      mediaType: MEDIA_TYPES[kind],
      format: kind === "pdf" ? "pdf" : xmlFormat(xmlText(bytes)),
      bytes,
      provenance,
    });
  }
  return uploads;
}

server.post("/postmark-inbound", describeRoute({ hide: true, security: [] }), async (c) => {
  const secret = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("POSTMARK_INBOUND_WEBHOOK_SECRET environment variable is not set");
    return c.json(actionFailure("Webhook secret not configured"), 500);
  }
  if (
    !isAuthorizedPostmarkRequest(
      { authorization: c.req.header("authorization"), secretHeader: c.req.header(SECRET_HEADER) },
      secret,
    )
  ) {
    return c.json(actionFailure("Unauthorized"), 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(actionFailure("Invalid webhook payload: not JSON"), 400);
  }
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(actionFailure(`Invalid webhook payload: ${parsed.error.message}`), 400);
  }
  const email = parsed.data;

  try {
    const address = await findAddress(email);
    if (!address?.enabled || address.deletedAt) {
      return c.json(actionFailure("Unknown or disabled address"), 403);
    }
    if (await findEmailImport(address.id, email.MessageID)) {
      return c.json(actionSuccess({ message: "Already received" }), 200);
    }

    const importId = `imp_${ulid()}`;
    try {
      await acceptImport(
        {
          id: importId,
          teamId: address.teamId,
          companyId: address.companyId,
          channel: "email",
          inboundAddressId: address.id,
          acceptedTypes: address.acceptedTypes,
          source: {
            channel: "email",
            from: email.FromFull?.Email ?? email.From ?? null,
            to: address.address,
            subject: email.Subject ?? null,
            receivedAt: receivedAt(email),
            authentication: authentication(email),
          },
          providerMessageId: email.MessageID,
          rawSha256: email.RawEmail ? sha256Hex(email.RawEmail) : null,
        },
        emailFiles(email),
      );
    } catch (error) {
      // The same message delivered twice at the same time: the first one keeps it.
      if (isUniqueViolation(error)) {
        return c.json(actionSuccess({ message: "Already received" }), 200);
      }
      throw error;
    }
    kickImportWorker();
    return c.json(actionSuccess({ importId }), 200);
  } catch (error) {
    console.error("Failed to receive inbound email:", error);
    return c.json(actionFailure("Failed to receive the email"), 500);
  }
});

export default server;
