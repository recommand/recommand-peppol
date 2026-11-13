import type { IdempotencyKeyRecord } from "@core/data/idempotency-keys";
import { IDEMPOTENCY_KEY_RETENTION_MS, idempotencyKeyIsStale } from "@core/data/idempotency-keys";
import { idempotencyKeys } from "@core/db/schema";
import { preparedSends } from "@peppol/db/schema";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import { sendDocumentScope } from "@peppol/utils/pipelines/sending/idempotency";
import { db } from "@recommand/db";
import { and, eq, getTableColumns, gt, lt, notExists, sql } from "drizzle-orm";

/** How long a prepared document can be sent: long enough to show it to the user and get their approval. */
const PREPARED_SEND_LIFETIME_MS = 15 * 60 * 1_000;

export type PreparedSend = typeof preparedSends.$inferSelect;

export type SendOutcome = IdempotencyKeyRecord & { stale: boolean };

/** Stores a document prepared to send. */
export const createPreparedSend = async (preparedSend: {
  companyId: string;
  fixedRoute: boolean;
  input: SendDocument;
  teamId: string;
}) => {
  const [created] = await db
    .insert(preparedSends)
    .values({ ...preparedSend, expiresAt: new Date(Date.now() + PREPARED_SEND_LIFETIME_MS) })
    .returning();

  return created!;
};

/**
 * Deletes the prepared documents nobody can ask about anymore. A handle that expired is answered for a day,
 * as `expired`, and for as long as the idempotency key its send went out under holds that send's outcome,
 * however late the send finished: a repeat gets that outcome rather than hearing there's no such document.
 */
export const purgeExpiredPreparedSends = async () => {
  const now = new Date();
  await db.delete(preparedSends).where(
    and(
      lt(preparedSends.expiresAt, new Date(now.getTime() - IDEMPOTENCY_KEY_RETENTION_MS)),
      notExists(
        db
          .select({ id: idempotencyKeys.id })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.teamId, preparedSends.teamId),
              // The scope of the company the document was prepared for, as `sendDocumentScope()` writes it
              eq(idempotencyKeys.scope, sql`${sendDocumentScope("")} || ${preparedSends.companyId}`),
              eq(idempotencyKeys.key, preparedSends.id),
              gt(idempotencyKeys.expiresAt, now)
            )
          )
      )
    )
  );
};

/** A prepared document of the team, or null when there's none with that ID, also when another team prepared it. */
export const getPreparedSend = async (teamId: string, id: string): Promise<PreparedSend | null> => {
  const [preparedSend] = await db
    .select()
    .from(preparedSends)
    .where(and(eq(preparedSends.id, id), eq(preparedSends.teamId, teamId)))
    .limit(1);

  return preparedSend ?? null;
};

/**
 * What a prepared document's send came to, as the idempotency key it went out under holds it: the response
 * it ended with, success or failure, a send that ended without one, or one still running, `stale` once it
 * ran longer than a send can. Null when the key holds nothing: the document wasn't sent, or its send was
 * refused before anything went out, which freed the key.
 */
export const getSendOutcome = async (preparedSend: PreparedSend): Promise<SendOutcome | null> => {
  const [key] = await db
    .select({ ...getTableColumns(idempotencyKeys), stale: idempotencyKeyIsStale })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.teamId, preparedSend.teamId),
        eq(idempotencyKeys.scope, sendDocumentScope(preparedSend.companyId)),
        eq(idempotencyKeys.key, preparedSend.id),
        gt(idempotencyKeys.expiresAt, new Date())
      )
    )
    .limit(1);

  return key ?? null;
};
