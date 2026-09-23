import { completeOnboardingStep } from '@core/data/onboarding';
import { teams } from '@core/db/schema';
import { teamExtensions } from '@peppol/db/schema';
import { db } from '@recommand/db';
import { and, eq } from 'drizzle-orm';
import type { ExtendedTeam } from '../teams';
import { createPlaygroundTeam } from './create-playground-team';

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

  // Complete the peppol.billing and peppol.subscription onboarding steps as we don't need to bill or subscribe to anything for playgrounds
  await completeOnboardingStep(userId, res.id, 'peppol.billing');
  await completeOnboardingStep(userId, res.id, 'peppol.subscription');

  return res;
}
