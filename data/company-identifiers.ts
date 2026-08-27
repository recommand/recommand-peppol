import { companies, companyIdentifiers, teamExtensions } from "@peppol/db/schema";
import { isSiren, validateIdentifier } from "@peppol/utils/identifier-validation";
import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { db } from "@recommand/db";
import { eq, and, asc, ne, or, isNull } from "drizzle-orm";
import { unregisterCompanyIdentifier, upsertCompanyRegistration } from "./smp-providers";
import { getTeamExtensionAndCompanyByCompanyId } from "./teams";

export type CompanyIdentifier = typeof companyIdentifiers.$inferSelect;
export type InsertCompanyIdentifier = typeof companyIdentifiers.$inferInsert;

export const cleanScheme = (scheme: string): string => {
  const cleanScheme = scheme.toLowerCase().trim().replace(/[^0-9]/g, "");
  if(cleanScheme.length === 0){
    throw new UserFacingError("Invalid scheme. The scheme must be a non-empty string.");
  }
  return cleanScheme;
}

export const cleanIdentifier = (identifier: string): string => {
  const cleanIdentifier = identifier.toLowerCase().trim().replace(/[^a-zA-Z0-9\-._~]/g, "");
  if(cleanIdentifier.length === 0){
    throw new UserFacingError("Invalid identifier. The identifier must be a non-empty string.");
  }
  return cleanIdentifier;
}

export async function getCompanyIdentifiers(companyId: string): Promise<CompanyIdentifier[]> {
  return await db
    .select()
    .from(companyIdentifiers)
    .where(eq(companyIdentifiers.companyId, companyId))
    .orderBy(asc(companyIdentifiers.scheme), asc(companyIdentifiers.identifier));
}

export async function getCompanyIdentifier(
  companyId: string,
  identifierId: string
): Promise<CompanyIdentifier | undefined> {
  return await db
    .select()
    .from(companyIdentifiers)
    .where(
      and(
        eq(companyIdentifiers.companyId, companyId),
        eq(companyIdentifiers.id, identifierId)
      )
    )
    .then((rows) => rows[0]);
}

export async function getCompanyIdentifierBySchemeAndValue(
  companyId: string,
  scheme: string,
  identifier: string
): Promise<CompanyIdentifier | undefined> {
  return await db
    .select()
    .from(companyIdentifiers)
    .where(
      and(
        eq(companyIdentifiers.companyId, companyId),
        eq(companyIdentifiers.scheme, cleanScheme(scheme)),
        eq(companyIdentifiers.identifier, cleanIdentifier(identifier))
      )
    )
    .then((rows) => rows[0]);
}

export async function getSendingCompanyIdentifier(companyId: string): Promise<CompanyIdentifier> {
  const identifiers = await db
    .select()
    .from(companyIdentifiers)
    .where(and(eq(companyIdentifiers.companyId, companyId)))
    .orderBy(asc(companyIdentifiers.scheme))
    .limit(1);

  if(identifiers.length === 0){
    throw new UserFacingError("No sending company identifier found. Ensure you have added a company identifier to your company.");
  }

  return identifiers[0];
}

/**
 * The identifiers a company may register under a French scheme all have to name
 * the company itself: its SIREN, the SIRET of one of its establishments, or an
 * electronic address of either, all of which open with that SIREN. The form of
 * each scheme is settled by validateIdentifier before this runs.
 */
function validateProtectedFrenchIdentifier({
  scheme,
  identifier,
  enterpriseNumber,
}: {
  scheme: string;
  identifier: string;
  enterpriseNumber: string | null;
}): void {
  const companySiren = cleanEnterpriseNumber(enterpriseNumber);

  if (!companySiren) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company enterprise number to be set.`);
  }

  if (!isSiren(companySiren)) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires the company enterprise number to be a valid SIREN, got: ${companySiren}`);
  }

  const cleanedIdentifier = cleanEnterpriseNumber(identifier)!;

  if (!cleanedIdentifier.startsWith(companySiren)) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} must belong to the company. Expected the company SIREN ${companySiren}, or a SIRET or address starting with it. Got: ${identifier}`);
  }
}

async function validateProtectedIdentifier({
  scheme,
  identifier,
  companyId,
}: {
  scheme: string;
  identifier: string;
  companyId: string;
}): Promise<void> {
  const teamInfo = await getTeamExtensionAndCompanyByCompanyId(companyId);
  if (!teamInfo) {
    throw new Error("Company is not associated with a team");
  }

  const cleanedScheme = cleanScheme(scheme);

  if (cleanedScheme === "0225" || cleanedScheme === "0002" || cleanedScheme === "0009") {
    validateProtectedFrenchIdentifier({
      scheme: cleanedScheme,
      identifier,
      enterpriseNumber: teamInfo.company.enterpriseNumber,
    });
  } else if (cleanedScheme === "0208") {
    const cleanedIdentifier = cleanEnterpriseNumber(identifier);
    const cleanedEnterpriseNumber = cleanEnterpriseNumber(teamInfo.company.enterpriseNumber);
    
    if (!cleanedEnterpriseNumber) {
      throw new UserFacingError("Company identifier with scheme 0208 requires a company enterprise number to be set.");
    }

    if (cleanedIdentifier !== cleanedEnterpriseNumber) {
      throw new UserFacingError(`Company identifier with scheme 0208 must match the company enterprise number. Expected: ${cleanedEnterpriseNumber}, got: ${cleanedIdentifier}`);
    }
  } else if (cleanedScheme === "9925") {
    const cleanedIdentifier = cleanVatNumber(identifier);
    const cleanedVatNumber = cleanVatNumber(teamInfo.company.vatNumber);
    
    if (!cleanedVatNumber) {
      throw new UserFacingError("Company identifier with scheme 9925 requires a company VAT number to be set.");
    }

    if (cleanedIdentifier !== cleanedVatNumber) {
      throw new UserFacingError(`Company identifier with scheme 9925 must match the company VAT number. Expected: ${cleanedVatNumber}, got: ${cleanedIdentifier}`);
    }
  }
}

export async function createCompanyIdentifier({
  companyIdentifier,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyIdentifier: InsertCompanyIdentifier;
  skipSmpRegistration: boolean;
  useTestNetwork: boolean;
}): Promise<CompanyIdentifier> {
  const cleanedScheme = cleanScheme(companyIdentifier.scheme);
  const cleanedIdentifierValue = cleanIdentifier(companyIdentifier.identifier);

  validateIdentifier(cleanedScheme, cleanedIdentifierValue);

  await validateProtectedIdentifier({
    scheme: companyIdentifier.scheme,
    identifier: companyIdentifier.identifier,
    companyId: companyIdentifier.companyId,
  });

  const canUpsert = await canUpsertCompanyIdentifier(companyIdentifier.scheme, companyIdentifier.identifier, undefined, companyIdentifier.companyId);
  if(!canUpsert){
    throw new UserFacingError(
      `Company identifier with scheme '${companyIdentifier.scheme}' and value '${companyIdentifier.identifier}' already exists`
    );
  }

  if(!skipSmpRegistration){
    await upsertCompanyRegistration({companyId: companyIdentifier.companyId, identifier: companyIdentifier, useTestNetwork: useTestNetwork});
  }

  const createdIdentifier = await db
    .insert(companyIdentifiers)
    .values({
      companyId: companyIdentifier.companyId,
      scheme: cleanedScheme,
      identifier: cleanedIdentifierValue,
    })
    .returning()
    .then((rows) => rows[0]);
  
  return createdIdentifier;
}

export async function updateCompanyIdentifier({
  companyIdentifier,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyIdentifier: InsertCompanyIdentifier & { id: string },
  skipSmpRegistration: boolean,
  useTestNetwork: boolean,
}): Promise<CompanyIdentifier> {
  const oldIdentifier = await getCompanyIdentifier(
    companyIdentifier.companyId,
    companyIdentifier.id
  );
  
  if (!oldIdentifier) {
    throw new UserFacingError("Company identifier not found");
  }

  const cleanedScheme = cleanScheme(companyIdentifier.scheme);
  const cleanedIdentifierValue = cleanIdentifier(companyIdentifier.identifier);

  validateIdentifier(cleanedScheme, cleanedIdentifierValue);

  await validateProtectedIdentifier({
    scheme: companyIdentifier.scheme,
    identifier: companyIdentifier.identifier,
    companyId: companyIdentifier.companyId,
  });

  // Check if the company identifier can be upserted
  const canUpsert = await canUpsertCompanyIdentifier(companyIdentifier.scheme, companyIdentifier.identifier, companyIdentifier.id, companyIdentifier.companyId);
  if (!canUpsert) {
    throw new UserFacingError(
      `Company identifier with scheme '${companyIdentifier.scheme}' and value '${companyIdentifier.identifier}' already exists`
    );
  }

  // Return if there is no change (taking lowercase into account)
  if(oldIdentifier.scheme === cleanedScheme && oldIdentifier.identifier === cleanedIdentifierValue){
    return oldIdentifier;
  }

  if(!skipSmpRegistration){
    await upsertCompanyRegistration({companyId: companyIdentifier.companyId, identifier: companyIdentifier, useTestNetwork: useTestNetwork}); // Register the new identifier
    await unregisterCompanyIdentifier({identifier: oldIdentifier, useTestNetwork: useTestNetwork}); // Unregister the old identifier
  }

  const updatedIdentifier = await db
    .update(companyIdentifiers)
    .set({
      scheme: cleanedScheme,
      identifier: cleanedIdentifierValue,
    })
    .where(
      and(
        eq(companyIdentifiers.companyId, companyIdentifier.companyId),
        eq(companyIdentifiers.id, companyIdentifier.id)
      )
    )
    .returning()
    .then((rows) => rows[0]);

  return updatedIdentifier;
}

export async function deleteCompanyIdentifier({
  companyId,
  identifierId,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyId: string;
  identifierId: string;
  skipSmpRegistration: boolean;
  useTestNetwork: boolean;
}): Promise<void> {
  const identifier = await getCompanyIdentifier(companyId, identifierId);
  if (!identifier) {
    throw new UserFacingError("Company identifier not found");
  }

  if(!skipSmpRegistration){
    await unregisterCompanyIdentifier({identifier, useTestNetwork});
  }

  await db
    .delete(companyIdentifiers)
    .where(
      and(
        eq(companyIdentifiers.companyId, companyId),
        eq(companyIdentifiers.id, identifierId)
      )
    );

}

/**
 * Check if a company identifier can be upserted.
 * Whether a company identifier can be upserted depends on whether we're in a playground or production context:
 * - In a playground context without test network, we can upsert a company identifier as long as it doesn't already exist on the same playground team as a SMP registered company.
 * - In a playground context with test network, we can upsert a company identifier as long as it is not already registered with any SMP registered playground company.
 * - In a production context, we can upsert a company identifier as long as it is not already registered with any SMP registered production company.
 * @param scheme 
 * @param identifier 
 * @param currentIdentifierId 
 * @param companyId
 * @returns 
 */
export async function canUpsertCompanyIdentifier(scheme: string, identifier: string, currentIdentifierId: string | undefined, companyId: string, excludeCompanyId?: string): Promise<boolean> {
  const teamInfo = await getTeamExtensionAndCompanyByCompanyId(companyId);
  if(!teamInfo){
    console.error("Company is not associated with a team", companyId);
    // This should never happen, a company is always associated with a team
    throw new Error("Company is not associated with a team");
  }
  const isPlaygroundTeam = teamInfo.teamExtension?.isPlayground ?? false;
  const useTestNetwork = teamInfo.teamExtension?.useTestNetwork ?? false;
  // Look for collisions
  return await db
    .select()
    .from(companyIdentifiers)
    .innerJoin(companies, eq(companies.id, companyIdentifiers.companyId))
    .leftJoin(teamExtensions, eq(companies.teamId, teamExtensions.id))
    .where(
      and(
        currentIdentifierId ? ne(companyIdentifiers.id, currentIdentifierId) : undefined, // Exclude the current identifier from the check
        excludeCompanyId ? ne(companies.id, excludeCompanyId) : undefined, // Exclude the provided company from the check
        // Look for duplicates within the same company. For SMP recipients, also look for collisions with other smp recipients
        or(
          eq(companies.id, companyId), // Include the current company (the same identifier cannot be added to the same company more than once)
          teamInfo.company.isSmpRecipient ? eq(companies.isSmpRecipient, true) : undefined, // Only include companies that are registered as SMP recipient (the same identifier can be used multiple times for sending)
        ),
        // Scope the search depending on the class (playground, playground with test network, production)
        or(
          eq(companies.teamId, teamInfo.company.teamId), // Include all companies on the same team
          isPlaygroundTeam
            ? (useTestNetwork ? eq(teamExtensions.useTestNetwork, true) : undefined) // Include all test network companies when on a playground team with test network
            : or(
              // Include all production companies when not on a playground team
              isNull(teamExtensions.isPlayground),
              eq(teamExtensions.isPlayground, false)
            )
        ),
        // The identifier and scheme must be the same for there to be a match
        and(
          eq(companyIdentifiers.scheme, scheme.toLowerCase().trim()),
          eq(companyIdentifiers.identifier, identifier.toLowerCase().trim()),
        )
      )
    )
    .then((rows) => rows.length === 0);
}
