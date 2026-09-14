import { writeAuditEvent } from "@core/lib/audit";
import { publishEvent } from "@core/data/rules/events";
import { sendDocumentEmail } from "@peppol/data/email/send-email";
import {
  resolveDocumentParsedWithAttachments,
  resolveDocumentXml,
} from "@peppol/data/offload/storage";
import {
  documentDeliveries,
  teamExtensions,
  transferEvents,
  transmittedDocuments,
} from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  claimEmailFallbackStatement,
  noteEmailFallbackAttemptStatement,
  releaseEmailFallbackStatement,
  stalledEmailFallbacksStatement,
} from "./email-fallback-consume";
import {
  EMAIL_FALLBACK_CLAIM_STALE_MS,
  runEmailFallback,
  type EmailFallbackDelivery,
  type EmailFallbackDependencies,
  type EmailFallbackOutcome,
} from "./email-fallback";

const deliverySelect = {
  id: documentDeliveries.id,
  address: documentDeliveries.address,
  status: documentDeliveries.status,
  failureCategory: documentDeliveries.failureCategory,
  failureMessage: documentDeliveries.failureMessage,
  provider: documentDeliveries.provider,
  providerTransactionId: documentDeliveries.providerTransactionId,
};

const databaseDependencies: EmailFallbackDependencies = {
  async claim(documentId, options) {
    // Taken and marked started in one statement: the row is only returned to the
    // one caller that found the request open (see email-fallback-consume).
    const [document] = await claimEmailFallbackStatement(db, documentId, options);
    if (!document || !document.request) {
      return null;
    }
    const [team] = await db
      .select({
        isPlayground: teamExtensions.isPlayground,
        useTestNetwork: teamExtensions.useTestNetwork,
      })
      .from(teamExtensions)
      .where(eq(teamExtensions.id, document.teamId))
      .limit(1);
    return {
      ...document,
      request: document.request,
      emailRecipients: document.emailRecipients ?? [],
      isPlayground: team?.isPlayground ?? false,
      useTestNetwork: team?.useTestNetwork ?? false,
    };
  },

  async noteAttempt(documentId, address, deliveryId) {
    await noteEmailFallbackAttemptStatement(db, documentId, address, deliveryId);
  },

  async recordedDelivery(deliveryId) {
    const [row] = await db
      .select(deliverySelect)
      .from(documentDeliveries)
      .where(eq(documentDeliveries.id, deliveryId))
      .limit(1);
    return row ?? null;
  },

  async loadPayload(documentId) {
    const [document] = await db
      .select({
        xml: transmittedDocuments.xml,
        xmlLocation: transmittedDocuments.xmlLocation,
        parsed: transmittedDocuments.parsed,
        attachmentsLocation: transmittedDocuments.attachmentsLocation,
        s3KeyPrefix: transmittedDocuments.s3KeyPrefix,
      })
      .from(transmittedDocuments)
      .where(eq(transmittedDocuments.id, documentId))
      .limit(1);
    if (!document) {
      return { xml: null, parsed: null };
    }
    const [xml, parsed] = await Promise.all([
      resolveDocumentXml(document),
      resolveDocumentParsedWithAttachments(document),
    ]);
    return { xml, parsed: parsed ?? null };
  },

  async sendEmail(options) {
    await sendDocumentEmail(options);
  },

  async recordDelivery(row) {
    // A row with this id was written by a run that stopped right after; it stands.
    await db.insert(documentDeliveries).values(row).onConflictDoNothing({ target: documentDeliveries.id });
    const [written] = await db
      .select(deliverySelect)
      .from(documentDeliveries)
      .where(eq(documentDeliveries.id, row.id!))
      .limit(1);
    return written!;
  },

  async finish({ document, deliveries, transferEvents: billing, sent }) {
    return await db.transaction(async (tx) => {
      // The request is cleared first, and only if it is still there: the run that
      // finds it gone was beaten to it, and writes nothing. The document's own email
      // fields keep telling the truth: it was mailed, to these addresses on top of
      // any it was mailed to before.
      const [closed] = await tx
        .update(transmittedDocuments)
        .set({
          emailFallback: null,
          ...(sent.length
            ? {
                sentOverEmail: true,
                // A list interpolated straight into `sql` becomes one parameter per
                // element; the addresses have to reach the statement as one array.
                emailRecipients: sql`array_cat(${transmittedDocuments.emailRecipients}, ${sql.param(sent)}::text[])`,
              }
            : {}),
        })
        .where(
          and(eq(transmittedDocuments.id, document.id), isNotNull(transmittedDocuments.emailFallback))
        )
        .returning({ id: transmittedDocuments.id });
      if (!closed) {
        return false;
      }
      if (billing.length) {
        await tx.insert(transferEvents).values(billing);
      }
      for (const delivery of deliveries) {
        await publishDeliveryEvent(tx, document, delivery);
      }
      return true;
    });
  },

  async release(documentId) {
    await releaseEmailFallbackStatement(db, documentId);
  },

  async audit({ documentId, teamId, sent, failed }) {
    await writeAuditEvent({
      action: "update",
      subsystem: "peppol.documents",
      objectType: "peppol.document",
      objectId: documentId,
      teamId,
      reasonCode: "email_fallback_sent",
      metadata: {
        sent,
        failed: failed.map((entry) => entry.address),
      },
    });
  },
};

async function publishDeliveryEvent(
  tx: Parameters<typeof publishEvent>[1]["tx"],
  document: Parameters<EmailFallbackDependencies["finish"]>[0]["document"],
  delivery: EmailFallbackDelivery
) {
  await publishEvent("peppol.document.delivery_status.v1", {
    teamId: document.teamId,
    aggregateType: "peppol.document",
    aggregateId: document.id,
    idempotencyKey: `peppol.document.delivery_status:${delivery.id}:${delivery.status}`,
    payload: {
      companyId: document.companyId,
      docType: document.type,
      senderId: document.senderId,
      receiverId: document.receiverId,
      envelopeId: document.envelopeId,
      deliveryId: delivery.id,
      channel: "email",
      address: delivery.address,
      status: delivery.status,
      previousStatus: null,
      failure:
        delivery.status === "failed"
          ? {
              category: delivery.failureCategory ?? "transport",
              message: delivery.failureMessage,
              providerCode: null,
            }
          : null,
    },
    tx,
  });
}

/**
 * Sends the email fallback a document's sender asked for, now that its Peppol
 * transmission has failed, or resumes a run of it that stopped. Nothing happens
 * for a document without one, or whose fallback another run is sending right now.
 */
export async function runEmailFallbackForDocument(
  documentId: string
): Promise<EmailFallbackOutcome> {
  return await runEmailFallback(documentId, databaseDependencies);
}

/**
 * Resumes the fallbacks that a stopped run left half done, a few at a time. Each
 * is resumed on its own, so one that fails again does not hold up the others.
 */
export async function resumeStalledEmailFallbacks(
  limit = 20,
  now: Date = new Date()
): Promise<{ found: number; resumed: number }> {
  const stalled = await stalledEmailFallbacksStatement(
    db,
    new Date(now.getTime() - EMAIL_FALLBACK_CLAIM_STALE_MS),
    limit
  );
  let resumed = 0;
  for (const { id } of stalled) {
    try {
      if ((await runEmailFallbackForDocument(id)).kind === "sent") {
        resumed += 1;
      }
    } catch (error) {
      console.error(`Failed to resume the email fallback of document ${id}:`, error);
    }
  }
  return { found: stalled.length, resumed };
}
