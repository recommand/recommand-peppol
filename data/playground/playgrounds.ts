import { emitBackendEvent } from '@core/lib/backend-events';
import { teams } from '@core/db/schema';
import { teamExtensions } from '@peppol/db/schema';
import { db } from '@recommand/db';
import { and, eq } from 'drizzle-orm';
import type { ExtendedTeam } from '../teams';
import { createPlaygroundTeam } from './create-playground-team';
import { PEPPOL_BACKEND_EVENTS, type PlaygroundCreatedEvent } from '@peppol/lib/backend-events';

export async function getPlayground(teamId: string): Promise<ExtendedTeam | null> {
  const playgrounds = await db
    .select()
    .from(teams)
    .innerJoin(teamExtensions, eq(teams.id, teamExtensions.id))
    .where(and(eq(teamExtensions.isPlayground, true), eq(teams.id, teamId)));
  if (playgrounds.length === 0) {
    return null;
  }
  return {
    ...playgrounds[0].teams,
    ...playgrounds[0].peppol_team_extensions,
  };
}

export async function createPlayground(
  userId: string,
  teamName: string,
  teamDescription: string = 'Playground',
  useTestNetwork: boolean = false,
): Promise<ExtendedTeam> {
  const res = await db.transaction((tx) =>
    createPlaygroundTeam(tx, userId, teamName, teamDescription, useTestNetwork),
  );

  // Lets other packages settle what a playground does not need, such as
  // onboarding steps that only apply to production teams.
  await emitBackendEvent<PlaygroundCreatedEvent>(PEPPOL_BACKEND_EVENTS.PLAYGROUND_CREATED, {
    teamId: res.id,
    userId,
  });

  return res;
}
