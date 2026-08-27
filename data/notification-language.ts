import { companies } from "@peppol/db/schema";
import { getTeamLanguage } from "@core/data/teams";
import { getMinimalTeamMembers } from "@core/data/team-members";
import { createServerT } from "@core/lib/translations-server";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";

/**
 * Translation function for a team's outgoing notifications.
 *
 * Falls back to English rather than throwing: a notification in the wrong
 * language is better than a notification that never goes out.
 */
async function getT(language: string): Promise<TranslationFunction> {
  try {
    return await createServerT(language);
  } catch (error) {
    console.error(`Failed to load translations for language ${language}:`, error);
    return fallbackT;
  }
}

export async function getTeamNotificationT(
  teamId: string
): Promise<TranslationFunction> {
  try {
    return await getT(await getTeamLanguage(teamId));
  } catch (error) {
    console.error(`Failed to resolve notification language for team ${teamId}:`, error);
    return fallbackT;
  }
}

/**
 * Same, for the team that owns a company.
 */
export async function getCompanyNotificationT(
  companyId: string
): Promise<TranslationFunction> {
  try {
    const [company] = await db
      .select({ teamId: companies.teamId })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) {
      return fallbackT;
    }

    return await getTeamNotificationT(company.teamId);
  } catch (error) {
    console.error(`Failed to resolve notification language for company ${companyId}:`, error);
    return fallbackT;
  }
}

export type NotificationGroup = {
  language: string;
  emails: string[];
  t: TranslationFunction;
};

/**
 * Splits a team's notification recipients into one group per language, so a
 * notification can be rendered once per language instead of once per team.
 *
 * `configuredEmails` are addresses set on the team itself (a billing address, a
 * support mailbox). When one is set it replaces the members entirely, and since
 * there is no user behind it there is no language to read: it gets the team's
 * own language via getTeamLanguage(). `alwaysEmails` are addresses that are
 * copied on every notification regardless; they join the team-language group so
 * they receive exactly one mail rather than one per language.
 */
export async function getTeamNotificationGroups(
  teamId: string,
  options: {
    configuredEmails?: (string | null | undefined)[];
    alwaysEmails?: string[];
  } = {}
): Promise<NotificationGroup[]> {
  const configured = (options.configuredEmails ?? [])
    .map((email) => email?.trim())
    .filter((email): email is string => !!email);

  const byLanguage = new Map<string, Set<string>>();
  const add = (language: string, email: string) => {
    const emails = byLanguage.get(language) ?? new Set<string>();
    emails.add(email);
    byLanguage.set(language, emails);
  };

  // A language lookup failure must not stop the notification: fall back to
  // English, the same way getTeamNotificationT() does.
  const teamLanguage = await getTeamLanguage(teamId).catch((error) => {
    console.error(`Failed to resolve notification language for team ${teamId}:`, error);
    return "en";
  });

  if (configured.length > 0) {
    for (const email of configured) {
      add(teamLanguage, email);
    }
  } else {
    for (const member of await getMinimalTeamMembers(teamId)) {
      add(member.user.language || teamLanguage, member.user.email);
    }
  }

  for (const email of options.alwaysEmails ?? []) {
    add(teamLanguage, email);
  }

  return Promise.all(
    [...byLanguage].map(async ([language, emails]) => ({
      language,
      emails: [...emails],
      t: await getT(language),
    }))
  );
}
