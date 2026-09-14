import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { transmittedDocuments } from "@peppol/db/schema";

/** When the run holding a document's request started, as the request records it. */
const requestStartedAt = sql`(${transmittedDocuments.emailFallback}->>'startedAt')::timestamptz`;

/**
 * The statement that takes a document's email fallback request for a run: one round
 * trip that locks the row while the request is there and not held by a live run,
 * marks it started, and returns the request as it was before. Of two callers running
 * it at the same time the second waits for the first's lock, then finds the request
 * held and gets no row back. A run that started before `staleBefore` is taken to
 * have died, and its request is taken over.
 *
 * `RETURNING` on an update yields the row after the update, so the value has to
 * come from the locked selection instead, which is what the common table
 * expression is for. Built as a function of the database so its SQL can be
 * asserted without one.
 */
export function claimEmailFallbackStatement(
  database: NodePgDatabase<Record<string, unknown>>,
  documentId: string,
  options: { now: Date; staleBefore: Date }
) {
  const taken = database.$with("taken").as(
    database
      .select({
        id: transmittedDocuments.id,
        teamId: transmittedDocuments.teamId,
        companyId: transmittedDocuments.companyId,
        type: transmittedDocuments.type,
        senderId: transmittedDocuments.senderId,
        receiverId: transmittedDocuments.receiverId,
        envelopeId: transmittedDocuments.envelopeId,
        emailRecipients: transmittedDocuments.emailRecipients,
        request: transmittedDocuments.emailFallback,
      })
      .from(transmittedDocuments)
      .where(
        and(
          eq(transmittedDocuments.id, documentId),
          isNotNull(transmittedDocuments.emailFallback),
          or(isNull(requestStartedAt), lt(requestStartedAt, options.staleBefore))
        )
      )
      .for("update")
  );
  return database
    .with(taken)
    .update(transmittedDocuments)
    .set({
      emailFallback: sql`${taken.request} || jsonb_build_object('startedAt', ${options.now.toISOString()}::text)`,
    })
    .from(taken)
    .where(eq(transmittedDocuments.id, taken.id))
    .returning({
      id: taken.id,
      teamId: taken.teamId,
      companyId: taken.companyId,
      type: taken.type,
      senderId: taken.senderId,
      receiverId: taken.receiverId,
      envelopeId: taken.envelopeId,
      emailRecipients: taken.emailRecipients,
      request: taken.request,
    });
}

/** Notes in a document's open request that `address` is being mailed as `deliveryId`. */
export function noteEmailFallbackAttemptStatement(
  database: NodePgDatabase<Record<string, unknown>>,
  documentId: string,
  address: string,
  deliveryId: string
) {
  const request = transmittedDocuments.emailFallback;
  return database
    .update(transmittedDocuments)
    .set({
      emailFallback: sql`jsonb_set(${request} || jsonb_build_object('attempts', coalesce(${request}->'attempts', '{}'::jsonb)), array['attempts', ${address}], ${JSON.stringify({ deliveryId })}::jsonb, true)`,
    })
    .where(and(eq(transmittedDocuments.id, documentId), isNotNull(request)));
}

/** Hands a document's request back after a failed run, keeping what it noted. */
export function releaseEmailFallbackStatement(
  database: NodePgDatabase<Record<string, unknown>>,
  documentId: string
) {
  const request = transmittedDocuments.emailFallback;
  return database
    .update(transmittedDocuments)
    .set({ emailFallback: sql`${request} - 'startedAt'` })
    .where(and(eq(transmittedDocuments.id, documentId), isNotNull(request)));
}

/**
 * The documents whose fallback a run started on and did not finish: the request is
 * still there with attempts noted, and no live run holds it. A run that died left
 * its start time; a run that failed and handed the request back left none.
 */
export function stalledEmailFallbacksStatement(
  database: NodePgDatabase<Record<string, unknown>>,
  staleBefore: Date,
  limit: number
) {
  const request = transmittedDocuments.emailFallback;
  return database
    .select({ id: transmittedDocuments.id })
    .from(transmittedDocuments)
    .where(
      and(
        isNotNull(request),
        sql`${request} ? 'attempts'`,
        or(isNull(requestStartedAt), lt(requestStartedAt, staleBefore))
      )
    )
    .orderBy(transmittedDocuments.id)
    .limit(limit);
}
