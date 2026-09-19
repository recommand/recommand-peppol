import { UserFacingError } from "@directory/utils/util";
import { XMLParser } from "fast-xml-parser";
import { fetchSmp } from "./client";
import { PARTICIPANT_SCHEME } from "./service-metadata";

// The participant migration endpoints of phoss SMP. The SMP talks to the Peppol SML
// itself (PrepareToMigrate on the way out, Migrate on the way in) with its own SMP
// certificate, so nothing here touches the SML directly.
//
// Outbound: start hands out a migration key and tells the SML we are willing to let
// the participant go; the participant stays with us until the receiving SMP claims it.
// finalize removes the service group locally once that happened; cancel withdraws.
// Inbound: the SML checks the key against what the previous SMP prepared, then points
// the participant at us and the SMP creates the service group locally.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
});

type ServiceGroupRef = {
  peppolIdentifierEas: string;
  peppolIdentifierAddress: string;
  useTestNetwork: boolean;
};

function serviceGroupPath({ peppolIdentifierEas, peppolIdentifierAddress }: ServiceGroupRef): string {
  return `${PARTICIPANT_SCHEME}::${peppolIdentifierEas}:${peppolIdentifierAddress}`;
}

function participant(ref: ServiceGroupRef): string {
  return `${ref.peppolIdentifierEas}:${ref.peppolIdentifierAddress}`;
}

export async function startOutboundMigration(ref: ServiceGroupRef): Promise<{ migrationKey: string }> {
  const response = await fetchSmp(`migration/outbound/start/${serviceGroupPath(ref)}`, {
    method: "PUT",
    useTestNetwork: ref.useTestNetwork,
  });
  const text = await response.text();

  if (!response.ok) {
    console.error(`Failed to start outbound migration for ${participant(ref)} in SMP`, text);
    if (text.includes("already in progress")) {
      throw new UserFacingError(`An outbound migration of ${participant(ref)} is already in progress on the SMP.`);
    }
    if (text.includes("does not exist")) {
      throw new UserFacingError(`${participant(ref)} is not registered on Recommand's SMP, so there is nothing to migrate.`);
    }
    throw new UserFacingError(`The Peppol SML did not accept the migration request for ${participant(ref)}.`);
  }

  const migrationKey = parser.parse(text)?.migrationOutboundResponse?.migrationKey;
  if (typeof migrationKey !== "string" || migrationKey.length === 0) {
    console.error(`SMP returned no migration key for ${participant(ref)}`, text);
    throw new UserFacingError(`The SMP did not return a migration key for ${participant(ref)}.`);
  }
  return { migrationKey };
}

/**
 * Withdraws an outbound migration. Returns false when the SMP no longer knows an
 * open migration for the participant, which is the state a cancel wants anyway.
 */
export async function cancelOutboundMigration(ref: ServiceGroupRef): Promise<boolean> {
  const response = await fetchSmp(`migration/outbound/cancel/${serviceGroupPath(ref)}`, {
    method: "PUT",
    useTestNetwork: ref.useTestNetwork,
  });
  if (response.ok) {
    return true;
  }
  const text = await response.text();
  console.error(`Failed to cancel outbound migration for ${participant(ref)} in SMP`, text);
  if (text.includes("Failed to resolve")) {
    return false;
  }
  throw new UserFacingError(`Failed to cancel the outbound migration of ${participant(ref)} on the SMP.`);
}

/**
 * Closes an outbound migration after the receiving SMP claimed the participant: the
 * SMP marks it migrated and deletes the service group locally only, the SML entry now
 * belongs to the other SMP. Returns false when the SMP had already finalized it.
 */
export async function finalizeOutboundMigration(ref: ServiceGroupRef): Promise<boolean> {
  const response = await fetchSmp(`migration/outbound/finalize/${serviceGroupPath(ref)}`, {
    method: "PUT",
    useTestNetwork: ref.useTestNetwork,
  });
  if (response.ok) {
    return true;
  }
  const text = await response.text();
  console.error(`Failed to finalize outbound migration for ${participant(ref)} in SMP`, text);
  if (text.includes("already finalized") || text.includes("Failed to resolve")) {
    return false;
  }
  throw new UserFacingError(`Failed to finalize the outbound migration of ${participant(ref)} on the SMP.`);
}

export type InboundMigrationOutcome = "migrated" | "alreadyOnThisSmp";

/**
 * Claims a participant with the key its previous SMP handed out. The SMP refuses
 * before calling the SML when it already serves the participant; that is reported
 * rather than thrown so the caller can carry on with a normal registration.
 */
export async function migrateInbound(ref: ServiceGroupRef & { migrationKey: string }): Promise<InboundMigrationOutcome> {
  const response = await fetchSmp(
    `migration/inbound/${serviceGroupPath(ref)}/${encodeURIComponent(ref.migrationKey)}`,
    {
      method: "PUT",
      useTestNetwork: ref.useTestNetwork,
    }
  );
  const text = await response.text();

  if (!response.ok) {
    if (text.includes("already exists")) {
      return "alreadyOnThisSmp";
    }
    console.error(`Failed to migrate ${participant(ref)} inbound in SMP`, text);
    throw new UserFacingError(
      `The Peppol SML did not accept the migration key for ${participant(ref)}. Check that the identifier matches the one your previous provider prepared the migration for, that the key is copied exactly, and that the previous provider has not cancelled the migration.`
    );
  }

  const result = parser.parse(text)?.migrationInboundResponse;
  if (result?.["@_success"] !== "true") {
    // The SML already routes the participant to us, but the SMP could not store the
    // service group. Nobody can deliver to the participant until that is repaired.
    console.error(`SMP reported a partial inbound migration for ${participant(ref)}`, text);
    throw new UserFacingError(
      `The migration of ${participant(ref)} was accepted by the Peppol SML but the SMP could not complete it. Contact support@recommand.eu so we can finish the registration for you.`
    );
  }
  return "migrated";
}
