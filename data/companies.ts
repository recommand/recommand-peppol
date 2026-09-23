import { companies, companyIdentifiers, companyVerificationLog, teamExtensions } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, or, isNull, asc, inArray } from "drizzle-orm";
import { unregisterCompanyRegistrations, upsertCompanyRegistrations } from "./smp-providers";
import { cleanEnterpriseNumber, cleanVatNumber, UserFacingError } from "@peppol/utils/util";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { getTeamExtension } from "./teams";
import { createCompanyDocumentType } from "./company-document-types";
import { canUpsertCompanyIdentifier, createCompanyIdentifier, getCompanyIdentifiers } from "./company-identifiers";
import { COUNTRIES, getCountrySupportLevel } from "@peppol/utils/countries";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { createVerificationSession, type VerificationExpectedDetails } from "./didit/client";
import { getCompanyVerificationLog, revokeOpenCompanyVerificationSessions } from "./company-verification";
import { companyDocumentsS3Prefix } from "./offload/storage";
import { enqueueS3PrefixDeletions } from "./s3-deletion";
import { validateCountryIdentifier } from "@peppol/utils/identifier-validation";
import { publishCompanyVerificationEvent } from "./company-verification-webhooks";
import { resolveDefaultPeppolProviders } from "./peppol-providers";
import { planCompanyCountryChange } from "./company-country-change";
import { lockCompanyRow } from "./company-row-lock";
import { getPartnerRegisteredFrenchReportingDeclarants } from "./fr-reporting-declarants";

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

export async function getCompanies(
  teamId: string,
  filters?: {
    enterpriseNumber?: string;
    vatNumber?: string;
  }
): Promise<Company[]> {
  const conditions = [eq(companies.teamId, teamId)];

  if (filters?.enterpriseNumber) {
    const cleanedEnterpriseNumber = cleanEnterpriseNumber(filters.enterpriseNumber);
    if (cleanedEnterpriseNumber) {
      conditions.push(eq(companies.enterpriseNumber, cleanedEnterpriseNumber));
    }
  }

  if (filters?.vatNumber) {
    const cleanedVatNumber = cleanVatNumber(filters.vatNumber);
    if (cleanedVatNumber) {
      conditions.push(eq(companies.vatNumber, cleanedVatNumber));
    }
  }

  return await db.select().from(companies).where(and(...conditions)).orderBy(asc(companies.name));
}

export async function getCompany(
  teamId: string,
  companyId: string
): Promise<Company | undefined> {
  return await db
    .select()
    .from(companies)
    .where(and(eq(companies.teamId, teamId), eq(companies.id, companyId)))
    .then((rows) => rows[0]);
}

export async function getCompanyById(
  companyId: string
): Promise<Company | undefined> {
  return await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .then((rows) => rows[0]);
}

/**
 * Find a company by its Peppol ID. When no playgroundTeamId is provided, the function will return a production company, otherwise it will return the company from the requested playground team.
 * @param peppolId The Peppol ID of the company
 * @param playgroundTeamId The team ID of the playground team, if the company is in a playground team. If no playgroundTeamId is provided, the function will return a production company.
 * @param requireSmpRecipient Only match companies registered as SMP recipient. Receiving requires that registration, sending does not.
 * @returns The company, or undefined when no company matches
 */
export async function findCompanyByPeppolId({
  peppolId,
  playgroundTeamId,
  useTestNetwork,
  requireSmpRecipient = true,
}: {
  peppolId: string,
  playgroundTeamId?: string
  useTestNetwork?: boolean;
  requireSmpRecipient?: boolean;
}): Promise<Company | undefined> {
  // The peppolId might start with iso6523-actorid-upis::
  if (peppolId.startsWith("iso6523-actorid-upis::")) {
    peppolId = peppolId.split("::")[1];
  }

  // The peppolId is in the format of 0208:1012081766 (e.g. 0208 for enterprise number, 9925 for vat number)
  const scheme = peppolId.split(":")[0];
  const identifier = peppolId.split(":")[1];
  if (!scheme || !identifier) {
    throw new UserFacingError("Invalid Peppol ID. The Peppol ID must be in the format of scheme:identifier");
  }
  const results = await db
    .select()
    .from(companies)
    .innerJoin(companyIdentifiers, eq(companies.id, companyIdentifiers.companyId))
    .leftJoin(teamExtensions, eq(companies.teamId, teamExtensions.id))
    .where(
      and(
        requireSmpRecipient ? eq(companies.isSmpRecipient, true) : undefined, // Only include companies that are registered as SMP recipient
        eq(companyIdentifiers.scheme, scheme.toLowerCase()),
        eq(companyIdentifiers.identifier, identifier.toLowerCase()),
        playgroundTeamId ? eq(companies.teamId, playgroundTeamId) : (
          useTestNetwork ? eq(teamExtensions.isPlayground, true) : or(
            isNull(teamExtensions.isPlayground),
            eq(teamExtensions.isPlayground, false)
          )
        ),
        useTestNetwork ? eq(teamExtensions.useTestNetwork, true) : undefined
      )
    );
  return results[0]?.peppol_companies;
}

/**
 * Get a company by its Peppol ID, throwing when no company matches. See findCompanyByPeppolId.
 */
export async function getCompanyByPeppolId(options: {
  peppolId: string,
  playgroundTeamId?: string
  useTestNetwork?: boolean;
  requireSmpRecipient?: boolean;
}): Promise<Company> {
  const company = await findCompanyByPeppolId(options);
  if (!company) {
    throw new Error(`Company with peppol id ${options.peppolId} not found as ${options.useTestNetwork ? "test" : "production"} company`);
  }
  return company;
}

function validateCompanyCountryIdentifiers({
  country,
  vatNumber,
  enterpriseNumber,
}: {
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
}): void {
  if (vatNumber && !/^[A-Z]{2}/.test(vatNumber)) {
    throw new UserFacingError("VAT number must start with a country code (e.g. BE, NL, DE)");
  }
  if (vatNumber && country && vatNumber.substring(0, 2).toUpperCase() !== country.toUpperCase()) {
    throw new UserFacingError(`VAT number country code (${vatNumber.substring(0, 2)}) does not match the selected country (${country})`);
  }
  if (!country) {
    return;
  }
  validateCountryIdentifier(country, {
    vatNumber,
    enterpriseNumber,
  });
}

/**
 * Creates a company on the providers its country is served by. Callers name a
 * country, never a provider: the mapping is ours, and a company on the wrong one
 * cannot be registered or verified.
 */
export async function createCompany(company: Omit<InsertCompany, "accessPointProvider" | "smpProvider"> & { skipDefaultCompanySetup: boolean }): Promise<Company> {
  const cleanedVat = cleanVatNumber(company.vatNumber);
  const cleanedEnterpriseNumber = cleanEnterpriseNumber(company.enterpriseNumber);
  const defaultPeppolProviders = resolveDefaultPeppolProviders(company.country);

  if (getCountrySupportLevel(company.country) === "unsupported") {
    throw new UserFacingError(`Country ${company.country} is not supported yet, so companies cannot be created in this country. We are working on supporting more countries in the future. Would you like to see support for this country? Let us know at support@recommand.eu.`);
  }

  validateCompanyCountryIdentifiers({
    country: company.country,
    vatNumber: cleanedVat,
    enterpriseNumber: cleanedEnterpriseNumber,
  });

  const teamExtension = await getTeamExtension(company.teamId);
  const isPlaygroundTeam = teamExtension?.isPlayground ?? false;
  const useTestNetwork = teamExtension?.useTestNetwork ?? false;

  const createdCompany = await db
    .insert(companies)
    .values({
      ...company,
      ...defaultPeppolProviders,
    })
    .returning()
    .then((rows) => rows[0]);

  try {
    sendSystemAlert(
      "Company Created",
      `Company ${createdCompany.name} has been created. It is ${createdCompany.isSmpRecipient ? "registered as an SMP recipient" : "not registered as an SMP recipient"}.`
    );
    if (!company.skipDefaultCompanySetup) {
      await setupCompanyDefaults({ company: createdCompany, isPlayground: isPlaygroundTeam, useTestNetwork, verificationRequirements: teamExtension?.verificationRequirements ?? undefined });
    }
  } catch (error) {
    sendSystemAlert(
      "Company Creation Failed",
      `Company ${createdCompany.name} could not be created. Error: \`\`\`\n${error}\n\`\`\``
    );
    await db.delete(companies).where(eq(companies.id, createdCompany.id));
    throw error;
  }

  return createdCompany;
}

/**
 * Setup the default document types and identifiers for a company.
 * @param company The company to setup defaults for
 * @param isPlayground Whether the company is in a playground team, if so we don't register the company in the SMP
 */
async function setupCompanyDefaults({ company, isPlayground, useTestNetwork, verificationRequirements }: { company: Company, isPlayground: boolean, useTestNetwork: boolean, verificationRequirements?: string }): Promise<void> {
  const skipSmpRegistration = !shouldRegisterWithSmp({ isPlayground, useTestNetwork, isSmpRecipient: company.isSmpRecipient, isVerified: company.isVerified, verificationRequirements });
  const countryInfo = COUNTRIES.find((country) => country.code === company.country);

  for (const documentType of countryInfo?.defaultDocumentTypes ?? []) {
    await createCompanyDocumentType({
      companyDocumentType: {
        companyId: company.id,
        docTypeId: documentType.docTypeId,
        processId: documentType.processId,
      },
      skipSmpRegistration,
      useTestNetwork,
    });
  }
  const cleanedEnterpriseNumber = cleanEnterpriseNumber(company.enterpriseNumber);
  if (countryInfo?.defaultEnterpriseNumberScheme && cleanedEnterpriseNumber) {
    try {
      await createCompanyIdentifier({
        companyIdentifier: {
          companyId: company.id,
          scheme: countryInfo.defaultEnterpriseNumberScheme,
          identifier: cleanedEnterpriseNumber,
        },
        skipSmpRegistration,
        useTestNetwork,
      });
    } catch (error) {
      console.error(`Failed to create enterprise number identifier for company ${company.id}: ${error}`);
    }
  }
  const cleanedVatNumber = cleanVatNumber(company.vatNumber);
  if (countryInfo?.defaultVatScheme && cleanedVatNumber) {
    try {
      await createCompanyIdentifier({
        companyIdentifier: {
          companyId: company.id,
          scheme: countryInfo.defaultVatScheme,
          identifier: cleanedVatNumber,
        },
        skipSmpRegistration,
        useTestNetwork,
      });
    } catch (error) {
      console.error(`Failed to create vat number identifier for company ${company.id}: ${error}`);
    }
  }
}

export async function updateCompany(company: Partial<InsertCompany> & { id: string; teamId: string }): Promise<Company> {
  const newCleanedVatNumber = cleanVatNumber(company.vatNumber);
  const newCleanedEnterpriseNumber = cleanEnterpriseNumber(company.enterpriseNumber);

  const oldCompany = await getCompany(company.teamId, company.id);
  if (!oldCompany) {
    throw new UserFacingError("Company not found");
  }

  // Existing companies in an unsupported country keep working; only switching to one is blocked
  if (company.country && company.country !== oldCompany.country && getCountrySupportLevel(company.country) === "unsupported") {
    throw new UserFacingError(`Country ${company.country} is not supported yet, so companies cannot be switched to this country. We are working on supporting more countries in the future. Would you like to see support for this country? Let us know at support@recommand.eu.`);
  }

  const effectiveCountry = company.country ?? oldCompany.country;
  // A number the request sets to null is being cleared, which a move to a country
  // without VAT registration needs; only an absent field keeps the current value.
  const effectiveVat = company.vatNumber !== undefined ? newCleanedVatNumber : cleanVatNumber(oldCompany.vatNumber);
  const effectiveEnterpriseNumber = company.enterpriseNumber !== undefined ? newCleanedEnterpriseNumber : cleanEnterpriseNumber(oldCompany.enterpriseNumber);

  validateCompanyCountryIdentifiers({
    country: effectiveCountry,
    vatNumber: effectiveVat,
    enterpriseNumber: effectiveEnterpriseNumber,
  });

  const teamExtension = await getTeamExtension(company.teamId);

  // Merge with existing company data, only updating provided fields
  const updatedFields: Partial<InsertCompany> = Object.fromEntries(
    Object.entries(company).filter(([_, value]) => value !== undefined)
  );
  
  // Check if cleaned vat number or enterprise number changed, and reset verification if so
  const oldCleanedEnterpriseNumber = cleanEnterpriseNumber(oldCompany.enterpriseNumber);
  const oldCleanedVatNumber = cleanVatNumber(oldCompany.vatNumber);
  
  const enterpriseNumberChanged = company.enterpriseNumber !== undefined && oldCleanedEnterpriseNumber !== newCleanedEnterpriseNumber;
  const vatNumberChanged = company.vatNumber !== undefined && oldCleanedVatNumber !== newCleanedVatNumber;
  
  if ((enterpriseNumberChanged || vatNumberChanged) && oldCompany.isVerified) {
    updatedFields.isVerified = false;
    updatedFields.verificationProofReference = null;
  }

  const useTestNetwork = teamExtension?.useTestNetwork ?? false;
  const isPlaygroundTeam = teamExtension?.isPlayground ?? false;
  const verificationRequirements = teamExtension?.verificationRequirements ?? undefined;
  const wasRegistered = shouldRegisterWithSmp({ isPlayground: isPlaygroundTeam, useTestNetwork, isSmpRecipient: oldCompany.isSmpRecipient, isVerified: oldCompany.isVerified, verificationRequirements });
  const shouldBeRegistered = shouldRegisterWithSmp({
    isPlayground: isPlaygroundTeam,
    useTestNetwork,
    isSmpRecipient: updatedFields.isSmpRecipient ?? oldCompany.isSmpRecipient,
    isVerified: updatedFields.isVerified ?? oldCompany.isVerified,
    verificationRequirements,
  });

  const newCountry = company.country && company.country !== oldCompany.country ? company.country : null;
  if (newCountry) {
    if (!wasRegistered && shouldBeRegistered) {
      // The country path never talks to an SMP; a registration is a separate update.
      throw new UserFacingError("Change the country first and register the company as a recipient in a separate update.");
    }
    const updatedCompany = await applyCompanyCountryChange({
      company,
      oldCompany,
      newCountry,
      updatedFields,
      enterpriseNumber: effectiveEnterpriseNumber ?? null,
      vatNumber: effectiveVat ?? null,
      teamExtension,
    });
    await finishCompanyUpdate({ oldCompany, updatedCompany, isPlaygroundTeam, numbersChanged: enterpriseNumberChanged || vatNumberChanged });
    return updatedCompany;
  }

  const updatedCompany = await db
    .update(companies)
    .set(updatedFields)
    .where(
      and(eq(companies.teamId, company.teamId), eq(companies.id, company.id))
    )
    .returning()
    .then((rows) => rows[0]);

  if (!wasRegistered && shouldBeRegistered) {
    try {
      await upsertCompanyRegistrations({ companyId: updatedCompany.id, useTestNetwork });
    } catch (error) {
      // If registration fails, unregister any company registrations that might have been registered
      try {
        await unregisterCompanyRegistrations({ companyId: updatedCompany.id, useTestNetwork });
      } catch (rollbackError) {
        // If this fails, we can't do much about it, we at least want to rollback the update of the company
        console.error(`Failed to unregister company registrations for company ${updatedCompany.id} after registration failed: ${rollbackError}`);
      }
      // Also rollback the update of the company
      await db.update(companies).set(oldCompany).where(eq(companies.id, company.id));
      throw error;
    }
  } else if (wasRegistered && !shouldBeRegistered) {
    try {
      await unregisterCompanyRegistrations({ companyId: updatedCompany.id, useTestNetwork });
    } catch (error) {
      // If unregistration fails, register all company registrations that might have been unregistered
      try {
        await upsertCompanyRegistrations({ companyId: updatedCompany.id, useTestNetwork });
      } catch (rollbackError) {
        // If this fails, we can't do much about it, we at least want to rollback the update of the company
        console.error(`Failed to register company registrations for company ${updatedCompany.id} after unregistration failed: ${rollbackError}`);
      }
      // Also rollback the update of the company
      await db.update(companies).set(oldCompany).where(eq(companies.id, company.id));
      throw error;
    }
  } else {
    try {
      // Ensure none of the company's identifiers are already registered as recipient with another company within the same class (playground, playground with test network, production)
      const identifiers = await getCompanyIdentifiers(updatedCompany.id);
      for (const identifier of identifiers) {
        const canUpsert = await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, identifier.id, updatedCompany.id);
        if (!canUpsert) {
          throw new UserFacingError("Company cannot be registered as SMP recipient, it has identifiers that are already registered as recipient with another company.");
        }
      }
    } catch (error) {
      // If the check fails, rollback the update of the company
      await db.update(companies).set(oldCompany).where(eq(companies.id, company.id));
      throw error;
    }
  }

  await finishCompanyUpdate({ oldCompany, updatedCompany, isPlaygroundTeam, numbersChanged: enterpriseNumberChanged || vatNumberChanged });

  return updatedCompany;
}

/** What every successful update ends with: the alert, and the revocations a number change brings. */
async function finishCompanyUpdate({
  oldCompany,
  updatedCompany,
  isPlaygroundTeam,
  numbersChanged,
}: {
  oldCompany: Company;
  updatedCompany: Company;
  isPlaygroundTeam: boolean;
  numbersChanged: boolean;
}): Promise<void> {
  if (!isPlaygroundTeam) {
    sendSystemAlert(
      "Company Updated",
      `Company ${updatedCompany.name} has been updated. It is ${updatedCompany.isSmpRecipient ? "registered as an SMP recipient" : "not registered as an SMP recipient"}.`
    );
  }

  if (numbersChanged) {
    await revokeOpenCompanyVerificationSessions(updatedCompany.id);

    if (oldCompany.isVerified && !updatedCompany.isVerified) {
      await publishCompanyVerificationEvent({
        verificationEventId: updatedCompany.id,
        teamId: updatedCompany.teamId,
        companyId: updatedCompany.id,
        status: "rejected",
      });
    }
  }
}

/**
 * Whether a verification session went past the empty link that is created with
 * every company: a representative submitted the form, an identity check ran, a
 * mandate was signed, or a decision was recorded. Such a session may have been
 * filed with a provider under the company's country, so the country is fixed. An
 * empty session that was revoked (for example because the enterprise number
 * changed) is rejected without anyone having started it, so the fields a
 * submission fills in decide, not the status alone.
 */
export function isStartedVerificationSession(session: {
  status: string;
  firstName: string | null;
  verificationProofReference: string | null;
  mandateAcceptedAt: Date | null;
  arratechOnboarding: unknown;
}): boolean {
  return (
    ["idVerificationRequested", "inReview", "verified"].includes(session.status) ||
    session.firstName !== null ||
    session.verificationProofReference !== null ||
    session.mandateAcceptedAt !== null ||
    session.arratechOnboarding !== null
  );
}

/**
 * Moves a company to another country in one transaction: the country, the
 * providers that serve it, its default identifiers and the rest of the update land
 * together or not at all. The company row is locked for the duration, which is
 * the lock a representative's submission and identifier writes take too, so a
 * verification cannot start under the old country while it moves. Nothing in here
 * talks to an SMP: a country change is refused while the company is registered,
 * and updateCompany refuses to combine it with a registration.
 */
async function applyCompanyCountryChange({
  company,
  oldCompany,
  newCountry,
  updatedFields,
  enterpriseNumber,
  vatNumber,
  teamExtension,
}: {
  company: Partial<InsertCompany> & { id: string; teamId: string };
  oldCompany: Company;
  newCountry: Company["country"];
  updatedFields: Partial<InsertCompany>;
  enterpriseNumber: string | null;
  vatNumber: string | null;
  teamExtension: Awaited<ReturnType<typeof getTeamExtension>>;
}): Promise<Company> {
  return await db.transaction(async (tx) => {
    const lockedCompany = await lockCompanyRow(tx, company.id, "update");
    if (!lockedCompany || lockedCompany.teamId !== company.teamId) {
      throw new UserFacingError("Company not found");
    }
    // Everything decided before the lock was decided on oldCompany. An update that
    // slipped in between (registering the company, verifying it, changing a number)
    // makes those decisions stale, so the request is refused rather than applied.
    if (
      lockedCompany.isSmpRecipient !== oldCompany.isSmpRecipient ||
      lockedCompany.isVerified !== oldCompany.isVerified ||
      lockedCompany.country !== oldCompany.country ||
      lockedCompany.smpProvider !== oldCompany.smpProvider ||
      lockedCompany.accessPointProvider !== oldCompany.accessPointProvider ||
      lockedCompany.enterpriseNumber !== oldCompany.enterpriseNumber ||
      lockedCompany.vatNumber !== oldCompany.vatNumber
    ) {
      throw new UserFacingError("The company changed while it was being updated. Please reload and try again.");
    }
    const networkRegistered = shouldRegisterWithSmp({
      isPlayground: teamExtension?.isPlayground ?? false,
      useTestNetwork: teamExtension?.useTestNetwork ?? false,
      isSmpRecipient: lockedCompany.isSmpRecipient,
      isVerified: lockedCompany.isVerified,
      verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
    });
    // A submission's claim on a session waits for the row lock above; the
    // sessions are read after taking it so one that got there first is seen.
    const sessions = await tx
      .select({
        status: companyVerificationLog.status,
        firstName: companyVerificationLog.firstName,
        verificationProofReference: companyVerificationLog.verificationProofReference,
        mandateAcceptedAt: companyVerificationLog.mandateAcceptedAt,
        arratechOnboarding: companyVerificationLog.arratechOnboarding,
      })
      .from(companyVerificationLog)
      .where(eq(companyVerificationLog.companyId, company.id));
    const identifiers = await tx
      .select({ id: companyIdentifiers.id, scheme: companyIdentifiers.scheme, identifier: companyIdentifiers.identifier })
      .from(companyIdentifiers)
      .where(eq(companyIdentifiers.companyId, company.id))
      .orderBy(asc(companyIdentifiers.scheme), asc(companyIdentifiers.identifier));
    const plan = planCompanyCountryChange({
      oldCompany: lockedCompany,
      newCountry,
      enterpriseNumber,
      vatNumber,
      requestedEnterpriseNumberScheme: company.enterpriseNumberScheme,
      identifiers,
      teamExtension,
      verificationStarted: lockedCompany.isVerified || sessions.some(isStartedVerificationSession),
      networkRegistered,
    });
    // The new default addresses must not be held by another recipient already.
    for (const identifier of plan.createIdentifiers) {
      if (!(await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, undefined, company.id))) {
        throw new UserFacingError(`Identifier ${identifier.scheme}:${identifier.identifier} is already registered as recipient with another company.`);
      }
    }
    if (plan.deleteIdentifierIds.length > 0) {
      await tx
        .delete(companyIdentifiers)
        .where(and(eq(companyIdentifiers.companyId, company.id), inArray(companyIdentifiers.id, plan.deleteIdentifierIds)));
    }
    if (plan.createIdentifiers.length > 0) {
      await tx
        .insert(companyIdentifiers)
        .values(plan.createIdentifiers.map((identifier) => ({ companyId: company.id, ...identifier })));
    }
    const updatedCompany = await tx
      .update(companies)
      .set({
        ...updatedFields,
        ...plan.providers,
        ...(plan.enterpriseNumberScheme !== undefined ? { enterpriseNumberScheme: plan.enterpriseNumberScheme } : {}),
      })
      .where(and(eq(companies.teamId, company.teamId), eq(companies.id, company.id)))
      .returning()
      .then((rows) => rows[0]);
    // The verification links handed out so far still work: their untouched
    // sessions take over the company details they will be checked against.
    await tx
      .update(companyVerificationLog)
      .set({
        companyName: updatedCompany.name,
        enterpriseNumber: updatedCompany.enterpriseNumber,
        address: updatedCompany.address,
        postalCode: updatedCompany.postalCode,
        city: updatedCompany.city,
        country: updatedCompany.country,
      })
      .where(and(eq(companyVerificationLog.companyId, company.id), eq(companyVerificationLog.status, "opened")));
    return updatedCompany;
  });
}

export async function deleteCompany({
  teamId,
  companyId,
}: {
  teamId: string;
  companyId: string;
}): Promise<void> {
  const company = await db
    .select()
    .from(companies)
    .where(and(eq(companies.teamId, teamId), eq(companies.id, companyId)))
    .then((rows) => rows[0]);
  if (!company) {
    throw new Error("Company not found");
  }

  const teamExtension = await getTeamExtension(teamId);
  const isPlaygroundTeam = teamExtension?.isPlayground ?? false;
  const useTestNetwork = teamExtension?.useTestNetwork ?? false;
  if (shouldRegisterWithSmp({ isPlayground: isPlaygroundTeam, useTestNetwork, isSmpRecipient: company.isSmpRecipient, isVerified: company.isVerified, verificationRequirements: teamExtension?.verificationRequirements ?? undefined })) {
    await unregisterCompanyRegistrations({ companyId, useTestNetwork });
  }

  // A French e-reporting registration is never removed automatically: removing a
  // declarant mid-period leaves that period unfiled at the partner. The rows go
  // with the company; support removes the partner registration once the last
  // period has been filed.
  const declarants = await getPartnerRegisteredFrenchReportingDeclarants(companyId);
  if (declarants.length > 0) {
    sendSystemAlert(
      "Company With French Reporting Declarant Deleted",
      `Company ${company.name} (${companyId}) was deleted while registered as a French e-reporting declarant with Arratech: ` +
        declarants.map((d) => `SIREN ${d.siren} (${d.environment})`).join(", ") +
        `. Remove the registration at Arratech once its last reporting period has been filed.`,
      "warning"
    );
  }

  // The company's documents are deleted by the FK cascade; their S3 objects
  // all live under the company's prefix and are removed by the background
  // deletion worker. Enqueueing in the same transaction as the delete means
  // the objects can never be orphaned, and the request doesn't wait on S3.
  await db.transaction(async (tx) => {
    await enqueueS3PrefixDeletions(tx, [
      companyDocumentsS3Prefix(teamId, companyId),
    ]);
    await tx
      .delete(companies)
      .where(and(eq(companies.teamId, teamId), eq(companies.id, companyId)));
  });
}

export async function verifyCompany({
  companyVerificationLogId,
  company,
  callback,
  expectedDetails,
}: {
  companyVerificationLogId: string;
  company: Pick<Company, "id" | "name" | "enterpriseNumber" | "vatNumber">;
  callback?: string;
  expectedDetails?: VerificationExpectedDetails;
}): Promise<string> {
  const companyVerificationLog = await getCompanyVerificationLog(companyVerificationLogId);
  if (!companyVerificationLog) {
    throw new UserFacingError("Company verification log not found");
  }

  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    throw new Error("DIDIT_API_KEY environment variable is not set");
  }

  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  if (!workflowId) {
    throw new Error("DIDIT_WORKFLOW_ID environment variable is not set");
  }

  const session = await createVerificationSession({
    apiKey,
    workflowId,
    vendorData: companyVerificationLog.id,
    callback,
    metadata: {
      company_id: company.id,
      company_name: company.name,
      enterprise_number: company.enterpriseNumber,
      vat_number: company.vatNumber,
    },
    expectedDetails,
  });

  if (!session || !session.url) {
    throw new UserFacingError("Failed to create verification session");
  }

  return session.url;
}
