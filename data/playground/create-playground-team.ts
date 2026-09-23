import { teamMembers, teams, userPermissions } from '@core/db/schema';
import { getTeamCreationPermissions } from '@core/lib/permissions';
import { teamExtensions } from '@peppol/db/schema';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtendedTeam } from '../teams';

type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

export async function createPlaygroundTeam(
  tx: Transaction,
  userId: string,
  teamName: string,
  teamDescription: string = 'Playground',
  useTestNetwork: boolean = false,
): Promise<ExtendedTeam> {
  const [newTeam] = await tx
    .insert(teams)
    .values({
      name: teamName,
      teamDescription,
    })
    .returning();

  await tx.insert(teamMembers).values({
    userId,
    teamId: newTeam.id,
  });

  const creationPermissions = getTeamCreationPermissions();
  if (creationPermissions.length > 0) {
    await tx.insert(userPermissions).values(
      creationPermissions.map((permission) => ({
        userId,
        teamId: newTeam.id,
        permissionId: permission.id,
        grantedByUserId: null,
      })),
    );
  }

  const [newExtension] = await tx
    .insert(teamExtensions)
    .values({
      id: newTeam.id,
      isPlayground: true,
      useTestNetwork,
      verificationRequirements: 'strict',
    })
    .returning();

  return {
    ...newTeam,
    ...newExtension,
  };
}
