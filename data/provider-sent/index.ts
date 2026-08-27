import { getAccessPointProvider } from "@peppol/data/access-point-providers";
import type { AccessPointProviderId } from "@peppol/data/peppol-providers";
import { findOutgoingEnvelopeClaim } from "@peppol/data/provider-sent/claims";
import { transmittedDocuments } from "@peppol/db/schema";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import { providerSentPipeline } from "@peppol/utils/pipelines/provider-sent";
import { db } from "@recommand/db";
import type { Context } from "@recommand/lib/api";
import { eq } from "drizzle-orm";

export type ProviderSentTransaction = {
  /** The request that reported the transaction, for the audit trail. */
  c: Context<any>;
  accessPointProvider: AccessPointProviderId;
  apTransactionId: string;
  useTestNetwork: boolean;
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  senderCountry?: string | null;
  /** The SBDH instance identifier the access point reports the transaction under. */
  docInstanceId?: string | null;
};

export type ProviderSentOutcome =
  /** Recorded as an outgoing document. */
  | "recorded"
  /** Sent by our own pipeline, which records it as part of the request that sent it. */
  | "sent-by-us"
  /** Nothing to record: already known, an unknown sender, or a provider we cannot fetch from. */
  | "known";

async function isAlreadyRecorded(apTransactionId: string): Promise<boolean> {
  const existing = await db
    .select({ id: transmittedDocuments.id })
    .from(transmittedDocuments)
    .where(eq(transmittedDocuments.apTransactionId, apTransactionId))
    .limit(1);
  return existing.length > 0;
}

/**
 * Records a transaction an access point reported as sent, unless it belongs to one of
 * our own sends.
 *
 * Our sending pipeline claims the envelope before the access point ever sees the
 * document, so by the time a transaction can be reported that claim is already
 * committed: a claimed envelope is ours and is left to the request that sent it,
 * while an unclaimed one was sent by the provider on our behalf and is recorded here.
 * There is no window in which both could act on the same transaction, and the unique
 * index on ap_transaction_id enforces that regardless.
 */
export async function recordProviderSentTransaction(
  transaction: ProviderSentTransaction
): Promise<ProviderSentOutcome> {
  if (
    transaction.docInstanceId &&
    (await findOutgoingEnvelopeClaim(transaction.docInstanceId))
  ) {
    return "sent-by-us";
  }

  if (await isAlreadyRecorded(transaction.apTransactionId)) {
    return "known";
  }

  const provider = getAccessPointProvider(transaction.accessPointProvider);
  if (!provider.downloadBusinessDocument) {
    console.error(
      "Access point cannot download business documents:",
      transaction.accessPointProvider
    );
    return "known";
  }

  const document = await provider.downloadBusinessDocument({
    transactionId: transaction.apTransactionId,
    useTestNetwork: transaction.useTestNetwork,
  });
  if (!document) {
    throw new Error("Failed to download business document");
  }

  try {
    const recorded = await providerSentPipeline({
      c: transaction.c,
      senderId: transaction.senderId,
      receiverId: transaction.receiverId,
      docTypeId: transaction.docTypeId,
      processId: transaction.processId,
      countryC1: transaction.senderCountry,
      body: document.body,
      contentType: document.contentType,
      useTestNetwork: transaction.useTestNetwork,
      sbdhInstanceIdentifier: transaction.docInstanceId,
      apTransactionId: transaction.apTransactionId,
    });
    if (!recorded) {
      console.warn(
        "Ignoring transaction for a sender that is not one of our companies:",
        transaction.senderId
      );
      return "known";
    }
    return "recorded";
  } catch (error) {
    // The unique index on ap_transaction_id decides who records a transaction, so
    // losing that decision means the document exists — the outcome we wanted.
    if (isUniqueViolation(error)) {
      return "known";
    }
    throw error;
  }
}
