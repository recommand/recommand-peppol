import { teamMembers, users } from "@core/db/schema";
import { db } from "@recommand/db";
import { and, eq } from "drizzle-orm";

/**
 * The addresses a playground really mails documents to: those of its members that
 * have been verified. An unverified address is left out, since anyone can sign up
 * with an address that is not theirs.
 */
export async function getPlaygroundMemberAddresses(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(users.emailVerified, true)));
  return rows.map((row) => row.email);
}
