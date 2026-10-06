import { companyVerificationLog } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A company's current verification session is its newest one that support has not
// withdrawn. Only the current session is reviewed, completed or resumed: an older
// one was replaced by a newer link. A withdrawn session stays in the history, with
// who withdrew it and why, but no longer hides the earlier session it gave way to.

export async function getCurrentVerificationSession(
  companyId: string,
  executor: typeof db | Transaction = db
): Promise<typeof companyVerificationLog.$inferSelect | undefined> {
  return await executor
    .select()
    .from(companyVerificationLog)
    .where(and(eq(companyVerificationLog.companyId, companyId), isNull(companyVerificationLog.withdrawal)))
    .orderBy(desc(companyVerificationLog.createdAt), desc(companyVerificationLog.id))
    .limit(1)
    .then((rows) => rows[0]);
}

/** True for a selected company_verification_log row that is its company's current session. */
export const isCurrentVerificationSession = sql<boolean>`(${companyVerificationLog.withdrawal} is null and not exists (
  select 1 from company_verification_log newer
  where newer.company_id = ${companyVerificationLog.companyId}
    and newer.withdrawal is null
    and (newer.created_at, newer.id) > (${companyVerificationLog.createdAt}, ${companyVerificationLog.id})
))`;
