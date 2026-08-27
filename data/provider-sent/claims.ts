import { outgoingEnvelopeClaims } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, lt } from "drizzle-orm";

// Claims are only consulted while a transaction is being reported back to us, which
// happens within minutes of the send. A day of history is far more than that and
// keeps the table small.
const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Records that our sending pipeline is about to hand this envelope to an access
 * point. Written before the document is sent, so any transaction the provider later
 * reports for it is already known to be ours — which is what lets the worker record
 * the provider's own transactions immediately instead of waiting to find out.
 *
 * Never throws: failing a send because this bookkeeping insert failed would be worse
 * than the worker having to fall back on its grace period.
 */
export async function claimOutgoingEnvelope(
  instanceIdentifier: string
): Promise<void> {
  try {
    await db
      .insert(outgoingEnvelopeClaims)
      .values({ instanceIdentifier })
      .onConflictDoNothing();
  } catch (error) {
    console.error("Failed to claim outgoing envelope:", error);
  }
}

/**
 * The moment our sending pipeline claimed this envelope, or null when no send of ours
 * owns it.
 */
export async function findOutgoingEnvelopeClaim(
  instanceIdentifier: string
): Promise<Date | null> {
  const [claim] = await db
    .select({ createdAt: outgoingEnvelopeClaims.createdAt })
    .from(outgoingEnvelopeClaims)
    .where(eq(outgoingEnvelopeClaims.instanceIdentifier, instanceIdentifier))
    .limit(1);
  return claim?.createdAt ?? null;
}

export async function pruneOutgoingEnvelopeClaims(): Promise<number> {
  const deleted = await db
    .delete(outgoingEnvelopeClaims)
    .where(
      lt(outgoingEnvelopeClaims.createdAt, new Date(Date.now() - CLAIM_RETENTION_MS))
    )
    .returning({ instanceIdentifier: outgoingEnvelopeClaims.instanceIdentifier });
  return deleted.length;
}
