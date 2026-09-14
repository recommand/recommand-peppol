import { writeAuditEvent } from "@core/lib/audit";
import { publishEvent } from "@core/data/rules/events";
import type { Tx } from "@core/data/rules/db";
import {
  documentDeliveries,
  providerDeliveryReports,
  transmittedDocuments,
} from "@peppol/db/schema";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { db } from "@recommand/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { runEmailFallbackForDocument } from "./email-fallback-db";
import {
  attachDeliveries,
  deliveryStatusMoves,
  type DeliveryRow,
  type DocumentDelivery,
  type ProviderDeliveryReport,
  type WithDeliveries,
} from "./model";

export * from "./model";

// A report waits for its document for as long as a send can plausibly take to
// record it, with a wide margin. Older ones belong to transactions that will never
// get a document here and are dropped.
const STAGED_REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ProviderReportOutcome =
  /** The delivery moved to the reported status, and its owner was told. */
  | "applied"
  /** The delivery was already in a final status: a repeat or a stale report. */
  | "unchanged"
  /** No delivery has been recorded for the transaction yet; the report waits for it. */
  | "staged";

/** The document a delivery belongs to, as much of it as a status change needs. */
type DeliveryDocument = {
  id: string;
  type: string;
  senderId: string;
  receiverId: string | null;
  envelopeId: string | null;
};

const deliveryRowSelect = {
  id: documentDeliveries.id,
  transmittedDocumentId: documentDeliveries.transmittedDocumentId,
  channel: documentDeliveries.channel,
  address: documentDeliveries.address,
  status: documentDeliveries.status,
  statusChangedAt: documentDeliveries.statusChangedAt,
  failureCategory: documentDeliveries.failureCategory,
  failureMessage: documentDeliveries.failureMessage,
  failureProviderCode: documentDeliveries.failureProviderCode,
};

/**
 * Writes the deliveries of a freshly recorded document. Runs inside the transaction
 * that writes the document, so a document never exists without its deliveries.
 */
export async function insertDocumentDeliveries(
  tx: Tx,
  rows: (typeof documentDeliveries.$inferInsert)[]
): Promise<DocumentDelivery[]> {
  if (rows.length === 0) {
    return [];
  }
  return await tx.insert(documentDeliveries).values(rows).returning();
}

export async function listDocumentDeliveries(
  transmittedDocumentId: string
): Promise<DocumentDelivery[]> {
  return await db
    .select()
    .from(documentDeliveries)
    .where(eq(documentDeliveries.transmittedDocumentId, transmittedDocumentId))
    .orderBy(documentDeliveries.createdAt, documentDeliveries.id);
}

/**
 * Adds to each document its deliveries and their summary, in one query for the
 * whole page. Incoming documents never have any and are not looked up.
 */
export async function withDocumentDeliveries<
  T extends {
    id: string;
    direction: "incoming" | "outgoing";
    peppolMessageId?: string | null;
    peppolConversationId?: string | null;
    envelopeId?: string | null;
  },
>(documents: T[]): Promise<WithDeliveries<T>[]> {
  const outgoingIds = documents
    .filter((document) => document.direction === "outgoing")
    .map((document) => document.id);
  const rows: DeliveryRow[] = outgoingIds.length
    ? await db
        .select(deliveryRowSelect)
        .from(documentDeliveries)
        .where(inArray(documentDeliveries.transmittedDocumentId, outgoingIds))
        .orderBy(documentDeliveries.createdAt, documentDeliveries.id)
    : [];
  return attachDeliveries(documents, rows);
}

async function findDeliveryByProviderTransaction(
  providerTransactionId: string
): Promise<{ delivery: DocumentDelivery; document: DeliveryDocument } | undefined> {
  const [row] = await db
    .select({
      delivery: documentDeliveries,
      document: {
        id: transmittedDocuments.id,
        type: transmittedDocuments.type,
        senderId: transmittedDocuments.senderId,
        receiverId: transmittedDocuments.receiverId,
        envelopeId: transmittedDocuments.envelopeId,
      },
    })
    .from(documentDeliveries)
    .innerJoin(
      transmittedDocuments,
      eq(transmittedDocuments.id, documentDeliveries.transmittedDocumentId)
    )
    .where(eq(documentDeliveries.providerTransactionId, providerTransactionId))
    .limit(1);
  return row;
}

/**
 * Moves a delivery to the status a report gives it, and tells the document's owner.
 * The move is a conditional update on the status the delivery was read in, so of two
 * callers applying reports to the same delivery only one gets to move it, and only
 * that one publishes the event: the customer hears about a change exactly once.
 * Returns false when the delivery was already final.
 */
async function applyReportToDelivery(
  delivery: DocumentDelivery,
  document: DeliveryDocument,
  report: Pick<
    ProviderDeliveryReport,
    "status" | "failure" | "eventId" | "eventType" | "payload"
  >
): Promise<boolean> {
  if (!deliveryStatusMoves(delivery.status, report.status)) {
    return false;
  }
  const now = new Date();
  const moved = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documentDeliveries)
      .set({
        status: report.status,
        statusChangedAt: now,
        failureCategory: report.failure?.category ?? null,
        failureMessage: report.failure?.message ?? null,
        failureProviderCode: report.failure?.providerCode ?? null,
        providerEventId: report.eventId,
        providerEventType: report.eventType,
        providerPayload: report.payload,
        lastCheckedAt: now,
      })
      .where(
        and(
          eq(documentDeliveries.id, delivery.id),
          eq(documentDeliveries.status, delivery.status)
        )
      )
      .returning();
    if (!updated) {
      return null;
    }
    await publishEvent("peppol.document.delivery_status.v1", {
      teamId: delivery.teamId,
      aggregateType: "peppol.document",
      aggregateId: document.id,
      idempotencyKey: `peppol.document.delivery_status:${delivery.id}:${report.status}`,
      payload: {
        companyId: delivery.companyId,
        docType: document.type,
        senderId: document.senderId,
        receiverId: document.receiverId,
        envelopeId: document.envelopeId,
        deliveryId: delivery.id,
        channel: delivery.channel,
        address: delivery.address,
        status: report.status,
        previousStatus: delivery.status,
        failure: report.failure,
      },
      tx,
    });
    return updated;
  });
  if (!moved) {
    return false;
  }

  await writeAuditEvent({
    action: "update",
    subsystem: "peppol.documents",
    objectType: "peppol.document",
    objectId: document.id,
    teamId: delivery.teamId,
    reasonCode: report.status === "failed" ? "delivery_failed" : "delivery_confirmed",
    metadata: {
      deliveryId: delivery.id,
      channel: delivery.channel,
      provider: delivery.provider,
      providerTransactionId: delivery.providerTransactionId,
      status: report.status,
      previousStatus: delivery.status,
      failureCategory: report.failure?.category ?? null,
      failureProviderCode: report.failure?.providerCode ?? null,
    },
  });
  if (report.status === "failed") {
    sendSystemAlert(
      "Document Delivery Failed",
      `The ${delivery.channel} delivery of document ${document.id} (transaction ${delivery.providerTransactionId}) failed after the provider had accepted it.\n` +
        `${report.failure?.providerCode ?? "no code"} ${report.failure?.category ?? "other"}: ${report.failure?.message ?? "no error details"}`,
      "warning"
    );
    // The failure is committed above whatever happens here: the fallback email the
    // sender asked for is sent now, once, and a problem with it is reported rather
    // than allowed to fail the report that carried the failure.
    if (delivery.channel === "peppol") {
      await runEmailFallbackAfterFailure(document.id);
    }
  }
  return true;
}

/**
 * Sends, or resumes, the email fallback of a document whose Peppol delivery failed.
 * A problem with it is logged and alerted, never thrown: the failure that triggered
 * it is already committed, and the request stays with the document for a retry.
 */
async function runEmailFallbackAfterFailure(documentId: string): Promise<void> {
  try {
    await runEmailFallbackForDocument(documentId);
  } catch (error) {
    console.error("Failed to send the email fallback:", error);
    sendSystemAlert(
      "Email Fallback Failed",
      `The email fallback for document ${documentId} could not be sent after its Peppol delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  }
}

/**
 * Applies what a provider reported about a transaction to the delivery it belongs
 * to. When no delivery has that transaction yet, because the report overtook the
 * send that is still recording its document, the report is kept and applied once
 * the document's deliveries are written. A retried report finds the delivery final
 * and changes nothing. Nothing is ever resent: the document's owner is told and
 * decides what to do.
 */
export async function applyProviderDeliveryReport(
  report: ProviderDeliveryReport
): Promise<ProviderReportOutcome> {
  const found = await findDeliveryByProviderTransaction(report.providerTransactionId);
  if (found) {
    if (await applyReportToDelivery(found.delivery, found.document, report)) {
      return "applied";
    }
    // A repeated failure report changes nothing, but the fallback its first
    // arrival should have sent may not have gone out, or may have stopped halfway:
    // the request is still with the document then, and this is its chance. When
    // it went out and was closed, this finds nothing to do.
    if (found.delivery.channel === "peppol" && found.delivery.status === "failed") {
      await runEmailFallbackAfterFailure(found.document.id);
    }
    return "unchanged";
  }

  await db
    .insert(providerDeliveryReports)
    .values({
      providerTransactionId: report.providerTransactionId,
      channel: report.channel,
      provider: report.provider,
      useTestNetwork: report.useTestNetwork,
      status: report.status,
      failureCategory: report.failure?.category ?? null,
      failureMessage: report.failure?.message ?? null,
      failureProviderCode: report.failure?.providerCode ?? null,
      eventId: report.eventId,
      eventType: report.eventType,
      payload: report.payload,
    })
    .onConflictDoNothing();

  // The document may have been recorded between the lookup above and the insert.
  // Its recording applies staged reports too, so whichever of the two finds the
  // delivery first moves it and the other finds it final.
  const applied = await applyStagedDeliveryReport(report.providerTransactionId);
  if (applied === "staged") {
    sendSystemAlert(
      "Delivery Report For Unrecorded Transaction",
      `The provider reported transaction ${report.providerTransactionId} as ${report.status} before any document was recorded for it. ` +
        `The report is applied once the document is recorded.\n` +
        `${report.failure?.providerCode ?? "no code"} ${report.failure?.category ?? ""}: ${report.failure?.message ?? "no error details"}`,
      "warning"
    );
  }
  return applied;
}

/**
 * Applies the report a provider made for a transaction before its document existed,
 * if there is one. Called after a document's deliveries are written, and after a
 * report is staged in case the document arrived in the meantime.
 */
export async function applyStagedDeliveryReport(
  providerTransactionId: string
): Promise<ProviderReportOutcome> {
  const [staged] = await db
    .select()
    .from(providerDeliveryReports)
    .where(eq(providerDeliveryReports.providerTransactionId, providerTransactionId))
    .limit(1);
  if (!staged) {
    return "unchanged";
  }
  const found = await findDeliveryByProviderTransaction(providerTransactionId);
  if (!found) {
    return "staged";
  }
  const applied = await applyReportToDelivery(found.delivery, found.document, {
    status: staged.status as ProviderDeliveryReport["status"],
    failure:
      staged.status === "failed"
        ? {
            category: staged.failureCategory ?? "other",
            message: staged.failureMessage,
            providerCode: staged.failureProviderCode,
          }
        : null,
    eventId: staged.eventId,
    eventType: staged.eventType,
    payload: staged.payload,
  });
  // Applied or found final: either way the report has reached its delivery.
  await db
    .delete(providerDeliveryReports)
    .where(eq(providerDeliveryReports.providerTransactionId, providerTransactionId));
  return applied ? "applied" : "unchanged";
}

export async function pruneStagedDeliveryReports(): Promise<number> {
  const deleted = await db
    .delete(providerDeliveryReports)
    .where(
      lt(
        providerDeliveryReports.reportedAt,
        new Date(Date.now() - STAGED_REPORT_RETENTION_MS)
      )
    )
    .returning({ providerTransactionId: providerDeliveryReports.providerTransactionId });
  return deleted.length;
}
