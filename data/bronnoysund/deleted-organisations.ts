import React from "react";
import { Cron } from "croner";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@recommand/db";
import type { Logger } from "@recommand/lib/logger";
import { sendEmail } from "@core/lib/email";
import { companies, companyIdentifiers } from "@peppol/db/schema";
import { getTeamExtension } from "@peppol/data/teams";
import { deleteCompanyIdentifier } from "@peppol/data/company-identifiers";
import { getTeamNotificationGroups } from "@peppol/data/notification-language";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import {
  ReceiverRegistrationRemovedNotification,
  subject as receiverRegistrationRemovedSubject,
} from "@peppol/emails/receiver-registration-removed-notification";
import { fetchDeletedOrganisations, type DeletedOrganisation } from "./client";
import { NORWEGIAN_ORGANISATION_SCHEME } from "./organisation-check";

// The Norwegian Peppol Authority requires SMP providers to remove the registrations
// of entities deleted from Enhetsregisteret. Once a day, the deletions the register
// published recently are matched against the 0192 identifiers we publish, and every
// match is deregistered from the SMP that holds it and removed from the company.
//
// The feed is read a few days back on every run, so a missed run or a late entry in
// the feed is caught by the next one. A match is removed the first time, so reading
// the same deletion again finds nothing.

const LOOKBACK_DAYS = 3;
const LOOKUP_CHUNK_SIZE = 500;

export type RegisteredNorwegianIdentifier = {
  identifierId: string;
  identifier: string;
  companyId: string;
  companyName: string;
  teamId: string;
  useTestNetwork: boolean;
};

export type DeletedOrganisationSweepDependencies = {
  fetchDeleted: (since: Date) => Promise<DeletedOrganisation[]>;
  /** The published 0192 identifiers among the given organisation numbers. */
  findRegistered: (organisationNumbers: string[]) => Promise<RegisteredNorwegianIdentifier[]>;
  deregister: (registration: RegisteredNorwegianIdentifier) => Promise<void>;
  notifyTeam: (registration: RegisteredNorwegianIdentifier, deletion: DeletedOrganisation) => Promise<void>;
  alert: typeof sendSystemAlert;
};

export type DeletedOrganisationSweepResult = {
  deletionsRead: number;
  deregistered: RegisteredNorwegianIdentifier[];
  failed: { registration: RegisteredNorwegianIdentifier; error: string }[];
};

export async function sweepDeletedNorwegianOrganisations(
  now: Date,
  dependencies: DeletedOrganisationSweepDependencies
): Promise<DeletedOrganisationSweepResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const deletions = await dependencies.fetchDeleted(since);
  const deletionByNumber = new Map(deletions.map((deletion) => [deletion.organisationNumber, deletion]));
  const registrations = deletionByNumber.size > 0
    ? await dependencies.findRegistered([...deletionByNumber.keys()])
    : [];

  const result: DeletedOrganisationSweepResult = { deletionsRead: deletions.length, deregistered: [], failed: [] };
  for (const registration of registrations) {
    const deletion = deletionByNumber.get(registration.identifier);
    if (!deletion) {
      continue;
    }
    try {
      await dependencies.deregister(registration);
    } catch (error) {
      result.failed.push({ registration, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    result.deregistered.push(registration);
    try {
      await dependencies.notifyTeam(registration, deletion);
    } catch (error) {
      console.error(`Failed to notify team ${registration.teamId} of the removed registration ${registration.identifier}:`, error);
    }
  }

  if (result.deregistered.length > 0) {
    await dependencies.alert(
      "Deleted Norwegian Organisations Deregistered",
      result.deregistered
        .map((registration) => `0192:${registration.identifier} of ${registration.companyName} (${registration.companyId})`)
        .join("\n") + "\nwere deleted from Enhetsregisteret and have been deregistered. The teams were notified.",
      "info"
    );
  }
  if (result.failed.length > 0) {
    await dependencies.alert(
      "Deleted Norwegian Organisations Not Deregistered",
      result.failed
        .map(({ registration, error }) => `0192:${registration.identifier} of ${registration.companyName} (${registration.companyId}): ${error}`)
        .join("\n") + `\nwere deleted from Enhetsregisteret but could not be deregistered. The daily runs retry them for ${LOOKBACK_DAYS} days; deregister them by hand if this keeps failing.`,
      "error"
    );
  }
  return result;
}

async function findRegisteredNorwegianIdentifiers(
  organisationNumbers: string[]
): Promise<RegisteredNorwegianIdentifier[]> {
  const registered: RegisteredNorwegianIdentifier[] = [];
  for (let start = 0; start < organisationNumbers.length; start += LOOKUP_CHUNK_SIZE) {
    const rows = await db
      .select({
        identifierId: companyIdentifiers.id,
        identifier: companyIdentifiers.identifier,
        companyId: companies.id,
        companyName: companies.name,
        teamId: companies.teamId,
        isSmpRecipient: companies.isSmpRecipient,
        isVerified: companies.isVerified,
        smpProvider: companies.smpProvider,
      })
      .from(companyIdentifiers)
      .innerJoin(companies, eq(companies.id, companyIdentifiers.companyId))
      .where(
        and(
          eq(companyIdentifiers.scheme, NORWEGIAN_ORGANISATION_SCHEME),
          inArray(companyIdentifiers.identifier, organisationNumbers.slice(start, start + LOOKUP_CHUNK_SIZE))
        )
      );
    for (const row of rows) {
      const teamExtension = await getTeamExtension(row.teamId);
      const useTestNetwork = teamExtension?.useTestNetwork ?? false;
      // Only what is published on an SMP is the network's concern. An identifier
      // that is not published stays: registering it later is refused by the
      // registration check.
      const published = shouldRegisterWithSmp({
        isPlayground: teamExtension?.isPlayground ?? false,
        useTestNetwork,
        isSmpRecipient: row.isSmpRecipient,
        isVerified: row.isVerified,
        verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
        smpProvider: row.smpProvider,
      });
      if (published) {
        registered.push({
          identifierId: row.identifierId,
          identifier: row.identifier,
          companyId: row.companyId,
          companyName: row.companyName,
          teamId: row.teamId,
          useTestNetwork,
        });
      }
    }
  }
  return registered;
}

async function notifyTeamOfRemovedRegistration(
  registration: RegisteredNorwegianIdentifier,
  deletion: DeletedOrganisation
): Promise<void> {
  const teamExtension = await getTeamExtension(registration.teamId);
  const groups = await getTeamNotificationGroups(registration.teamId, {
    configuredEmails: [teamExtension?.supportEmailAddress],
  });
  const props = {
    companyName: registration.companyName,
    identifier: `${NORWEGIAN_ORGANISATION_SCHEME}:${registration.identifier}`,
    deletedOn: deletion.deletedAt.slice(0, 10),
  };
  for (const { emails, t } of groups) {
    if (emails.length === 0) {
      continue;
    }
    await sendEmail({
      to: emails.join(", "),
      subject: receiverRegistrationRemovedSubject({ ...props, t }),
      email: React.createElement(ReceiverRegistrationRemovedNotification, { ...props, t }),
    });
  }
}

export async function deregisterDeletedNorwegianOrganisations(now = new Date()): Promise<DeletedOrganisationSweepResult> {
  return await sweepDeletedNorwegianOrganisations(now, {
    fetchDeleted: (since) => fetchDeletedOrganisations(since),
    findRegistered: findRegisteredNorwegianIdentifiers,
    deregister: (registration) =>
      deleteCompanyIdentifier({
        companyId: registration.companyId,
        identifierId: registration.identifierId,
        skipSmpRegistration: false,
        useTestNetwork: registration.useTestNetwork,
      }),
    notifyTeam: notifyTeamOfRemovedRegistration,
    alert: sendSystemAlert,
  });
}

export function initializeDeletedNorwegianOrganisationsCron(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  new Cron(
    "30 5 * * *",
    {
      name: "peppol.deleted-norwegian-organisations",
      timezone: "Europe/Oslo",
      protect: () =>
        logger.warn("Skipping peppol.deleted-norwegian-organisations tick: previous run still running"),
    },
    async () => {
      try {
        const result = await deregisterDeletedNorwegianOrganisations();
        logger.info(
          `Deleted Norwegian organisations: read ${result.deletionsRead} deletions, deregistered ${result.deregistered.length}, failed ${result.failed.length}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Deleted Norwegian organisations sweep failed: ${message}`);
        await sendSystemAlert(
          "Deleted Norwegian Organisations Sweep Failed",
          `The daily check of Enhetsregisteret deletions failed and is retried tomorrow: ${message}`,
          "error"
        );
      }
    }
  );
}
