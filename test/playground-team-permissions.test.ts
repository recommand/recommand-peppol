import { describe, expect, it } from 'bun:test';
import { teamMembers, teams, userPermissions } from '@core/db/schema';
import { teamExtensions } from '@peppol/db/schema';
import { createPlaygroundTeam } from '../data/playground/create-playground-team';

type Insert = {
  table: unknown;
  values: unknown;
};

const inserts: Insert[] = [];

const transaction = {
  insert(table: unknown) {
    return {
      values(values: unknown) {
        inserts.push({ table, values });

        if (table === teams) {
          return {
            returning: async () => [
              {
                id: 'team_playground',
                name: 'Playground',
                teamDescription: 'Playground',
              },
            ],
          };
        }

        if (table === teamExtensions) {
          return {
            returning: async () => [
              {
                id: 'team_playground',
                isPlayground: true,
                useTestNetwork: false,
                verificationRequirements: 'strict',
              },
            ],
          };
        }

        return Promise.resolve();
      },
    };
  },
};

describe('playground team creation', () => {
  it('grants the creator permission to manage the new team', async () => {
    inserts.length = 0;

    await createPlaygroundTeam(transaction as never, 'user_creator', 'Playground');

    expect(inserts).toContainEqual({
      table: teamMembers,
      values: {
        userId: 'user_creator',
        teamId: 'team_playground',
      },
    });
    const permissionInsert = inserts.find((insert) => insert.table === userPermissions);
    expect(permissionInsert?.values).toEqual(
      expect.arrayContaining([
        {
          userId: 'user_creator',
          teamId: 'team_playground',
          permissionId: 'core.team.manage',
          grantedByUserId: null,
        },
      ]),
    );
  });
});
