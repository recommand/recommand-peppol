import { preparedSends } from "@peppol/db/schema";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import { db } from "@recommand/db";
import { lt } from "drizzle-orm";

/** How long a prepared document can be sent: long enough to show it to the user and get their approval. */
const PREPARED_SEND_LIFETIME_MS = 15 * 60 * 1_000;

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

/** Deletes the prepared documents that expired, which nothing can send anymore. */
export const purgeExpiredPreparedSends = async () => {
  await db.delete(preparedSends).where(lt(preparedSends.expiresAt, new Date()));
};
