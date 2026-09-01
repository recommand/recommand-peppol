import { teamExtensions } from "@peppol/db/schema";
import { companies } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { count, eq } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { UserFacingError } from "@directory/utils/util";

export async function onTeamCreated(_event: string, context: { id: string, tx: PgTransaction<NodePgQueryResultHKT, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>> }) {
  console.log("onTeamCreated", context);
  // This is not triggered for playground teams, as they are created through a non-core API

  // Create a new team extension with verification requirements set to strict
  await context.tx.insert(teamExtensions).values({
    id: context.id,
    isPlayground: false,
    useTestNetwork: false,
    verificationRequirements: "strict",
  });
}

export async function onTeamBeforeDelete(_event: string, context: { teamId: string }) {
  // A team cannot be deleted while it still owns companies, as those companies
  // (and their Peppol registrations) must be disposed of explicitly first.
  const [{ companyCount }] = await db
    .select({ companyCount: count() })
    .from(companies)
    .where(eq(companies.teamId, context.teamId));

  if (companyCount > 0) {
    throw new UserFacingError(
      "This team still has companies. Please delete all companies before deleting the team."
    );
  }
}