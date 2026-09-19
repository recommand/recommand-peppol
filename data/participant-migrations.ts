import { companies, participantMigrations } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { UserFacingError } from "@directory/utils/util";
import { shouldInteractWithPeppolNetwork, shouldRegisterWithSmp } from "@peppol/utils/playground";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import {
  cleanIdentifier,
  cleanScheme,
  deleteCompanyIdentifier,
  getCompanyIdentifier,
  getCompanyIdentifiers,
  type CompanyIdentifier,
} from "./company-identifiers";
import { getTeamExtensionAndCompanyByCompanyId } from "./teams";
import type { Company } from "./companies";
import type { TeamExtension } from "./teams";
import { upsertCompanyRegistration } from "./smp-providers";
import {
  cancelOutboundMigration as smpCancelOutboundMigration,
  finalizeOutboundMigration as smpFinalizeOutboundMigration,
  startOutboundMigration as smpStartOutboundMigration,
} from "./phoss-smp/migration";
import { isRecommandSmpUrl } from "./phoss-smp/client";
import { getSmpUrl } from "./recipient";

// A Peppol participant can only be published for receiving by one SMP. Moving it to
// another SMP without a gap goes through a one-time migration key: the SMP that has
// the participant asks the Peppol SML to prepare the move and receives a key, the
// customer hands the key to the new provider, and the new SMP claims the participant
// with it. This module keeps our side of both directions.
//
// Inbound keys are stored first and consumed at the moment the identifier is actually
// registered in the SMP (see phoss-smp/index.ts), because for teams with strict
// verification that moment only comes once the company passed its identity check.

export type ParticipantMigration = typeof participantMigrations.$inferSelect;

/**
 * The rules the Peppol SML applies to a migration key: 8 to 24 characters, at least
 * two upper case letters, two lower case letters, two digits and two of the special
 * characters @#$%()[]{}*^_-!~|+= and no whitespace.
 */
export const MIGRATION_KEY_PATTERN =
  /^(?=.{8,24}$)(?=(.*[@#$%()[\]{}*^_!~|+=-]){2,})(?=(.*[A-Z]){2})(?=(.*[a-z]){2})(?=(.*[0-9]){2})(?=\S+$).*$/;

export const MIGRATION_KEY_REQUIREMENTS =
  "A migration key has 8 to 24 characters with at least two upper case letters, two lower case letters, two digits and two of the special characters @#$%()[]{}*^_-!~|+=, and contains no spaces.";

export function normalizeMigrationKey(migrationKey: string): string {
  const trimmed = migrationKey.trim();
  if (!MIGRATION_KEY_PATTERN.test(trimmed)) {
    throw new UserFacingError(`Invalid migration key. ${MIGRATION_KEY_REQUIREMENTS}`);
  }
  return trimmed;
}

const OPEN_STATUSES = ["pending", "inProgress"] as const;

type Participant = { scheme: string; identifier: string };

function cleanParticipant(participant: Participant): Participant {
  return { scheme: cleanScheme(participant.scheme), identifier: cleanIdentifier(participant.identifier) };
}

function participantAddress(participant: Participant): string {
  return `${participant.scheme}:${participant.identifier}`;
}

export async function getParticipantMigration(migrationId: string): Promise<ParticipantMigration | undefined> {
  return await db
    .select()
    .from(participantMigrations)
    .where(eq(participantMigrations.id, migrationId))
    .then((rows) => rows[0]);
}

export async function getParticipantMigrations(
  companyId: string,
  participant?: Participant
): Promise<ParticipantMigration[]> {
  const cleaned = participant ? cleanParticipant(participant) : undefined;
  return await db
    .select()
    .from(participantMigrations)
    .where(
      and(
        eq(participantMigrations.companyId, companyId),
        cleaned ? eq(participantMigrations.scheme, cleaned.scheme) : undefined,
        cleaned ? eq(participantMigrations.identifier, cleaned.identifier) : undefined
      )
    )
    .orderBy(desc(participantMigrations.createdAt), desc(participantMigrations.id));
}

export async function getOpenParticipantMigration({
  companyId,
  scheme,
  identifier,
  useTestNetwork,
}: Participant & { companyId: string; useTestNetwork: boolean }): Promise<ParticipantMigration | undefined> {
  const cleaned = cleanParticipant({ scheme, identifier });
  return await db
    .select()
    .from(participantMigrations)
    .where(
      and(
        eq(participantMigrations.companyId, companyId),
        eq(participantMigrations.scheme, cleaned.scheme),
        eq(participantMigrations.identifier, cleaned.identifier),
        eq(participantMigrations.useTestNetwork, useTestNetwork),
        inArray(participantMigrations.status, [...OPEN_STATUSES])
      )
    )
    .then((rows) => rows[0]);
}

/** The stored inbound key waiting to be used when this participant is registered. */
export async function getPendingInboundMigration(
  options: Participant & { companyId: string; useTestNetwork: boolean }
): Promise<ParticipantMigration | undefined> {
  const open = await getOpenParticipantMigration(options);
  return open?.direction === "inbound" && open.status === "pending" ? open : undefined;
}

async function setStatus(
  migrationId: string,
  status: ParticipantMigration["status"],
  errorMessage: string | null = null
): Promise<ParticipantMigration> {
  const final = status === "completed" || status === "cancelled" || status === "failed";
  const updated = await db
    .update(participantMigrations)
    .set({ status, errorMessage, completedAt: final ? new Date() : null })
    .where(eq(participantMigrations.id, migrationId))
    .returning()
    .then((rows) => rows[0]);
  if (!updated) {
    throw new UserFacingError("Participant migration not found");
  }
  return updated;
}

export async function completeParticipantMigration(migrationId: string): Promise<ParticipantMigration> {
  return await setStatus(migrationId, "completed");
}

export async function failParticipantMigration(migrationId: string, errorMessage: string): Promise<ParticipantMigration> {
  return await setStatus(migrationId, "failed", errorMessage);
}

async function loadCompanyContext(companyId: string): Promise<{ company: Company; teamExtension: TeamExtension | null }> {
  const context = await getTeamExtensionAndCompanyByCompanyId(companyId);
  if (!context) {
    throw new UserFacingError("Company not found");
  }
  return context;
}

/** Only participants on our own SMP can be moved with a key; partner SMPs have no such API. */
function assertMigrationSupported(company: Company, teamExtension: TeamExtension | null): void {
  if (company.smpProvider !== "recommand-smp1") {
    throw new UserFacingError(
      `Migration keys are only supported for companies published through Recommand's own SMP. This company is published through a partner SMP (${company.smpProvider}).`
    );
  }
  if (!shouldInteractWithPeppolNetwork({ isPlayground: teamExtension?.isPlayground, useTestNetwork: teamExtension?.useTestNetwork })) {
    throw new UserFacingError("This playground team is not connected to a Peppol network, so there is no registration to migrate.");
  }
  if (!company.isSmpRecipient) {
    throw new UserFacingError(
      "The company is not registered as a recipient (isSmpRecipient is false). Only recipient registrations can be migrated."
    );
  }
}

/**
 * Stores an inbound key for a participant of the company. It is used the next time
 * the identifier is registered in the SMP; until then it is pending. A newer key
 * replaces an older pending one, since a previous provider can only have one
 * migration open per participant and a re-issued key voids the earlier one.
 */
export async function createPendingInboundMigration({
  companyId,
  scheme,
  identifier,
  migrationKey,
  useTestNetwork,
}: Participant & { companyId: string; migrationKey: string; useTestNetwork: boolean }): Promise<ParticipantMigration> {
  const { company, teamExtension } = await loadCompanyContext(companyId);
  assertMigrationSupported(company, teamExtension);
  const key = normalizeMigrationKey(migrationKey);
  const cleaned = cleanParticipant({ scheme, identifier });

  const open = await getOpenParticipantMigration({ companyId, ...cleaned, useTestNetwork });
  if (open?.direction === "outbound") {
    throw new UserFacingError(
      `An outbound migration of ${participantAddress(cleaned)} is in progress. Cancel it before migrating the participant in.`
    );
  }
  if (open) {
    await setStatus(open.id, "cancelled", "Replaced by a newer migration key");
  }

  return await db
    .insert(participantMigrations)
    .values({
      companyId,
      ...cleaned,
      direction: "inbound",
      status: "pending",
      migrationKey: key,
      useTestNetwork,
    })
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Takes over an existing identifier of the company from its previous SMP. When the
 * company is currently publishable, the migration runs right away; otherwise the key
 * waits for the registration that follows verification.
 */
export async function requestInboundMigration({
  companyId,
  identifierId,
  migrationKey,
}: {
  companyId: string;
  identifierId: string;
  migrationKey: string;
}): Promise<ParticipantMigration> {
  const { company, teamExtension } = await loadCompanyContext(companyId);
  const companyIdentifier = await getCompanyIdentifier(companyId, identifierId);
  if (!companyIdentifier) {
    throw new UserFacingError("Company identifier not found");
  }
  const useTestNetwork = teamExtension?.useTestNetwork ?? false;

  const migration = await createPendingInboundMigration({
    companyId,
    scheme: companyIdentifier.scheme,
    identifier: companyIdentifier.identifier,
    migrationKey,
    useTestNetwork,
  });

  const registerNow = shouldRegisterWithSmp({
    isPlayground: teamExtension?.isPlayground ?? false,
    useTestNetwork,
    isSmpRecipient: company.isSmpRecipient,
    isVerified: company.isVerified,
    verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
  });
  if (!registerNow) {
    return migration;
  }

  await upsertCompanyRegistration({
    companyId,
    identifier: { scheme: companyIdentifier.scheme, identifier: companyIdentifier.identifier },
    useTestNetwork,
  });

  const result = (await getParticipantMigration(migration.id)) ?? migration;
  if (result.status === "failed") {
    throw new UserFacingError(result.errorMessage ?? "The migration failed");
  }
  return result;
}

/**
 * Asks the SML to release a participant we publish. The key that comes back is what
 * the customer gives their new provider; we keep publishing the participant until
 * that provider claims it and the migration is finalized.
 */
export async function startOutboundMigration({
  companyId,
  identifierId,
}: {
  companyId: string;
  identifierId: string;
}): Promise<ParticipantMigration> {
  const { company, teamExtension } = await loadCompanyContext(companyId);
  assertMigrationSupported(company, teamExtension);
  const companyIdentifier = await getCompanyIdentifier(companyId, identifierId);
  if (!companyIdentifier) {
    throw new UserFacingError("Company identifier not found");
  }
  const useTestNetwork = teamExtension?.useTestNetwork ?? false;
  const registered = shouldRegisterWithSmp({
    isPlayground: teamExtension?.isPlayground ?? false,
    useTestNetwork,
    isSmpRecipient: company.isSmpRecipient,
    isVerified: company.isVerified,
    verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
  });
  if (!registered) {
    throw new UserFacingError(
      `${participantAddress(companyIdentifier)} is not published on the Peppol network through Recommand, so there is nothing to migrate out.`
    );
  }

  const open = await getOpenParticipantMigration({
    companyId,
    scheme: companyIdentifier.scheme,
    identifier: companyIdentifier.identifier,
    useTestNetwork,
  });
  if (open) {
    throw new UserFacingError(
      `A ${open.direction} migration (${open.id}) of ${participantAddress(companyIdentifier)} is already open. Cancel it first.`
    );
  }

  const { migrationKey } = await smpStartOutboundMigration({
    peppolIdentifierEas: companyIdentifier.scheme,
    peppolIdentifierAddress: companyIdentifier.identifier,
    useTestNetwork,
  });

  const migration = await db
    .insert(participantMigrations)
    .values({
      companyId,
      scheme: companyIdentifier.scheme,
      identifier: companyIdentifier.identifier,
      direction: "outbound",
      status: "inProgress",
      migrationKey,
      useTestNetwork,
    })
    .returning()
    .then((rows) => rows[0]);

  sendSystemAlert(
    "Outbound Peppol migration started",
    `${participantAddress(companyIdentifier)} of company ${company.name} (${company.id}) can now be claimed by another SMP.`,
    "warning"
  );
  return migration;
}

function requireOpenOutbound(migration: ParticipantMigration | undefined): ParticipantMigration {
  if (!migration) {
    throw new UserFacingError("Participant migration not found");
  }
  if (migration.direction !== "outbound" || migration.status !== "inProgress") {
    throw new UserFacingError(`Migration ${migration.id} is not an outbound migration in progress (it is ${migration.direction} and ${migration.status}).`);
  }
  return migration;
}

export async function cancelOutboundMigration(migrationId: string): Promise<ParticipantMigration> {
  const migration = requireOpenOutbound(await getParticipantMigration(migrationId));
  await smpCancelOutboundMigration({
    peppolIdentifierEas: migration.scheme,
    peppolIdentifierAddress: migration.identifier,
    useTestNetwork: migration.useTestNetwork,
  });
  return await setStatus(migration.id, "cancelled");
}

/** Whether the SML still resolves the participant to our SMP. */
export async function isPublishedByRecommand(participant: Participant & { useTestNetwork: boolean }): Promise<boolean> {
  const smpUrl = await getSmpUrl({
    recipientAddress: participantAddress(participant),
    useTestNetwork: participant.useTestNetwork,
  });
  return isRecommandSmpUrl(smpUrl, participant.useTestNetwork);
}

export type OutboundFinalization = {
  migration: ParticipantMigration;
  /** What happened to the identifier on our side once the participant left. */
  detached: "identifierDeleted" | "recipientDisabled" | "identifierNotFound";
};

/**
 * Closes an outbound migration after the new SMP claimed the participant. Refused
 * while the network still routes the participant to us, unless forced. Afterwards the
 * identifier leaves the company, or, when it was the company's only identifier, the
 * company stops being a recipient so nothing tries to publish the participant again.
 */
export async function finalizeOutboundMigration({
  migrationId,
  force = false,
}: {
  migrationId: string;
  force?: boolean;
}): Promise<OutboundFinalization> {
  const migration = requireOpenOutbound(await getParticipantMigration(migrationId));
  const participant = { scheme: migration.scheme, identifier: migration.identifier };

  if (!force && (await isPublishedByRecommand({ ...participant, useTestNetwork: migration.useTestNetwork }))) {
    throw new UserFacingError(
      `The Peppol network still routes ${participantAddress(participant)} to Recommand's SMP, so the receiving provider has not completed the migration yet. Wait for them, or finalize with force if you are sure.`
    );
  }

  await smpFinalizeOutboundMigration({
    peppolIdentifierEas: migration.scheme,
    peppolIdentifierAddress: migration.identifier,
    useTestNetwork: migration.useTestNetwork,
  });
  const completed = await setStatus(migration.id, "completed");

  const identifiers = await getCompanyIdentifiers(migration.companyId);
  const departed = identifiers.find(
    (candidate: CompanyIdentifier) => candidate.scheme === participant.scheme && candidate.identifier === participant.identifier
  );
  let detached: OutboundFinalization["detached"] = "identifierNotFound";
  if (departed && identifiers.length > 1) {
    await deleteCompanyIdentifier({
      companyId: migration.companyId,
      identifierId: departed.id,
      skipSmpRegistration: true,
      useTestNetwork: migration.useTestNetwork,
    });
    detached = "identifierDeleted";
  } else if (departed) {
    await db.update(companies).set({ isSmpRecipient: false }).where(eq(companies.id, migration.companyId));
    detached = "recipientDisabled";
  }

  sendSystemAlert(
    "Outbound Peppol migration finalized",
    `${participantAddress(participant)} left company ${migration.companyId} for another SMP (${detached}).`,
    "warning"
  );
  return { migration: completed, detached };
}
