import { companies, companyVerificationLog } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, inArray } from "drizzle-orm";
import { getEnterpriseData } from "./cbe-public-search/client";
import { UserFacingError } from "@peppol/utils/util";
import { getCompany, verifyCompany, type Company } from "./companies";
import { getTeamExtension } from "./teams";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { unregisterCompanyRegistrations, upsertCompanyRegistrations } from "./phoss-smp";
import { publishCompanyVerificationEvent } from "./company-verification-webhooks";

export type CompanyVerificationLog = typeof companyVerificationLog.$inferSelect;
export type CompanyVerificationStatus = CompanyVerificationLog["status"];
export type CompanyVerificationFinalStatus = Extract<CompanyVerificationStatus, "verified" | "rejected" | "error">;
export type PlaygroundVerificationOutcome = Extract<CompanyVerificationFinalStatus, "verified" | "rejected">;

export type FinalizeCompanyVerificationResult = {
  status: CompanyVerificationFinalStatus;
  errorMessage: string | null;
};

const OPEN_VERIFICATION_STATUSES = ["opened", "idVerificationRequested", "inReview"] as const;
const FINAL_VERIFICATION_STATUSES = ["verified", "rejected", "error"] as const;
const VERIFICATION_REVOKED_MESSAGE =
  "Verification session revoked because the company enterprise number or VAT number changed.";

export function namesMatch(a: string, b: string): boolean {
  const partsA = a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const partsB = b.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const [shorter, longer] = partsA.length <= partsB.length ? [partsA, partsB] : [partsB, partsA];
  return shorter.length > 0 && shorter.every((part) => longer.includes(part));
}

export async function getCompanyVerificationLog(
  id: string
): Promise<CompanyVerificationLog | undefined> {
  return await db
    .select()
    .from(companyVerificationLog)
    .where(eq(companyVerificationLog.id, id))
    .then((rows) => rows[0]);
}

export async function revokeOpenCompanyVerificationSessions(companyId: string): Promise<void> {
  await db
    .update(companyVerificationLog)
    .set({
      status: "rejected",
      errorMessage: VERIFICATION_REVOKED_MESSAGE,
    })
    .where(
      and(
        eq(companyVerificationLog.companyId, companyId),
        inArray(companyVerificationLog.status, [...OPEN_VERIFICATION_STATUSES])
      )
    );
}

export function getBaseUrlOrThrow(): string {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL environment variable is not set");
  }

  return baseUrl;
}

function getCompanyVerificationErrorMessage({
  error,
  status,
}: {
  error: unknown;
  status: "verified" | "rejected";
}): string {
  if (error instanceof UserFacingError) {
    return error.message;
  }

  if (status === "verified") {
    return "Identity verification succeeded, but we could not activate your company on the Peppol network. Please contact support@recommand.eu for assistance.";
  }

  return "We could not complete this verification because the company could not be updated on the Peppol network. Please contact support@recommand.eu for assistance.";
}

async function setCompanyVerificationError({
  companyVerificationLogId,
  verificationProofReference,
  errorMessage,
}: {
  companyVerificationLogId: string;
  verificationProofReference: string;
  errorMessage: string;
}): Promise<void> {
  await db
    .update(companyVerificationLog)
    .set({
      status: "error",
      verificationProofReference,
      errorMessage,
    })
    .where(eq(companyVerificationLog.id, companyVerificationLogId));
}

export async function finalizeCompanyVerification({
  companyVerificationLogId,
  company,
  status,
  verificationProofReference,
}: {
  companyVerificationLogId: string;
  company: Company;
  status: "verified" | "rejected";
  verificationProofReference: string;
}): Promise<FinalizeCompanyVerificationResult> {
  const existingLog = await getCompanyVerificationLog(companyVerificationLogId);
  if (!existingLog) {
    throw new UserFacingError("Company verification log not found");
  }
  if ((FINAL_VERIFICATION_STATUSES as readonly string[]).includes(existingLog.status)) {
    return {
      status: existingLog.status as CompanyVerificationFinalStatus,
      errorMessage: existingLog.errorMessage,
    };
  }

  const isVerified = status === "verified";
  const teamExtension = await getTeamExtension(company.teamId);
  const useTestNetwork = teamExtension?.useTestNetwork ?? false;
  const verificationRequirements = teamExtension?.verificationRequirements ?? undefined;
  const smpStateBase = {
    isPlayground: teamExtension?.isPlayground,
    useTestNetwork,
    isSmpRecipient: company.isSmpRecipient,
    verificationRequirements,
  };
  const wasRegistered = shouldRegisterWithSmp({ ...smpStateBase, isVerified: company.isVerified });
  const shouldBeRegistered = shouldRegisterWithSmp({ ...smpStateBase, isVerified });
  const smpTransition =
    !wasRegistered && shouldBeRegistered
      ? "register"
      : wasRegistered && !shouldBeRegistered
        ? "unregister"
        : "none";

  const rollbackSmpTransition = async (): Promise<void> => {
    if (smpTransition === "register") {
      try {
        await unregisterCompanyRegistrations({ companyId: company.id, useTestNetwork });
      } catch (rollbackError) {
        console.error(`Failed to unregister company ${company.id} while rolling back verification finalization:`, rollbackError);
      }
    }

    if (smpTransition === "unregister") {
      try {
        await upsertCompanyRegistrations({ companyId: company.id, useTestNetwork });
      } catch (rollbackError) {
        console.error(`Failed to restore SMP registrations for company ${company.id} while rolling back verification finalization:`, rollbackError);
      }
    }
  };

  if (smpTransition === "register") {
    try {
      await upsertCompanyRegistrations({ companyId: company.id, useTestNetwork });
    } catch (error) {
      await rollbackSmpTransition();
      console.error(`Failed to register company ${company.id} with SMP while finalizing verification:`, error);
      const errorMessage = getCompanyVerificationErrorMessage({ error, status });
      await setCompanyVerificationError({
        companyVerificationLogId,
        verificationProofReference,
        errorMessage,
      });
      await publishCompanyVerificationEvent({
        verificationEventId: companyVerificationLogId,
        teamId: company.teamId,
        companyId: company.id,
        status: "error",
        errorMessage,
      });
      return { status: "error", errorMessage };
    }
  }

  if (smpTransition === "unregister") {
    try {
      await unregisterCompanyRegistrations({ companyId: company.id, useTestNetwork });
    } catch (error) {
      await rollbackSmpTransition();
      console.error(`Failed to unregister company ${company.id} from SMP while finalizing verification:`, error);
      const errorMessage = getCompanyVerificationErrorMessage({ error, status });
      await setCompanyVerificationError({
        companyVerificationLogId,
        verificationProofReference,
        errorMessage,
      });
      await publishCompanyVerificationEvent({
        verificationEventId: companyVerificationLogId,
        teamId: company.teamId,
        companyId: company.id,
        status: "error",
        errorMessage,
      });
      return { status: "error", errorMessage };
    }
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(companyVerificationLog)
        .set({ status, verificationProofReference, errorMessage: null })
        .where(eq(companyVerificationLog.id, companyVerificationLogId));
      await tx
        .update(companies)
        .set({
          isVerified,
          verificationProofReference,
        })
        .where(eq(companies.id, company.id));
    });
  } catch (error) {
    await rollbackSmpTransition();
    throw error;
  }

  await publishCompanyVerificationEvent({
    verificationEventId: companyVerificationLogId,
    teamId: company.teamId,
    companyId: company.id,
    status,
  });

  return { status, errorMessage: null };
}

export async function createCompanyVerificationLog({
  teamId,
  companyId,
}: {
  teamId: string;
  companyId: string;
}): Promise<{ log: CompanyVerificationLog; verificationUrl: string }> {
  const baseUrl = getBaseUrlOrThrow();

  const company = await getCompany(teamId, companyId);
  if (!company) {
    throw new UserFacingError("Company not found");
  }

  const log = await db
    .insert(companyVerificationLog)
    .values({
      companyId,
      companyName: company.name,
      enterpriseNumber: company.enterpriseNumber,
    })
    .returning()
    .then((rows) => rows[0]);

  const verificationUrl = `${baseUrl}/company-verification/${log.id}/verify`;
  return { log, verificationUrl };
}

export async function submitIdentityForm(
  companyVerificationLogId: string,
  log: CompanyVerificationLog,
  company: Company,
  firstName: string,
  lastName: string
): Promise<string> {
  if (log.status !== "opened") {
    throw new UserFacingError("This verification has already been submitted.");
  }

  let effectiveFirstName = firstName;
  let effectiveLastName = lastName;

  if (company.country === "BE") {
    if (!company.enterpriseNumber) {
      throw new UserFacingError("Company does not have an enterprise number. Please complete the company details first.");
    }
    const lookupNumber = company.country === "BE" && company.enterpriseNumber.toUpperCase().startsWith("BE") ? company.enterpriseNumber.slice(2) : company.enterpriseNumber;
    const enterpriseData = await getEnterpriseData(lookupNumber, company.country);
    const validRepresentatives = enterpriseData.representatives.filter(
      (rep): rep is typeof rep & { firstName: string; lastName: string } => Boolean(rep.firstName && rep.lastName)
    );

    if (validRepresentatives.length === 0) {
      effectiveFirstName = "UNKNOWN";
      effectiveLastName = "UNKNOWN";
    } else {
      const isRepresentative = validRepresentatives.some(
        (rep) =>
          namesMatch(rep.firstName, firstName) &&
          namesMatch(rep.lastName, lastName)
      );
      if (!isRepresentative) {
        throw new UserFacingError(
          "The provided name does not match any representative of this company in the CBE registry. Please contact support@recommand.eu to proceed with the verification."
        );
      }
    }
  }

  const verificationUrl = await createIdVerificationUrl(companyVerificationLogId, company, {
    firstName: effectiveFirstName,
    lastName: effectiveLastName,
  });

  await db
    .update(companyVerificationLog)
    .set({
      firstName: effectiveFirstName,
      lastName: effectiveLastName,
      status: "idVerificationRequested",
    })
    .where(eq(companyVerificationLog.id, companyVerificationLogId))
    .returning()
    .then((rows) => rows[0]);

  return verificationUrl;
}

export async function submitPlaygroundVerification(
  companyVerificationLogId: string,
  log: CompanyVerificationLog,
  company: Company,
  outcome: PlaygroundVerificationOutcome
): Promise<FinalizeCompanyVerificationResult> {
  if (log.status === "verified" || log.status === "rejected" || log.status === "error") {
    throw new UserFacingError("This verification has already been completed.");
  }

  return await finalizeCompanyVerification({
    companyVerificationLogId,
    company,
    status: outcome,
    verificationProofReference: outcome === "verified" ? "PLAYGROUND_VERIFIED" : "PLAYGROUND_REJECTED",
  });
}

export async function requestIdVerification(
  companyVerificationLogId: string,
  log: CompanyVerificationLog,
  company: Company
): Promise<string> {
  if (log.status !== "idVerificationRequested") {
    throw new UserFacingError("Verification is not in a state that allows identity verification.");
  }

  const verificationUrl = await createIdVerificationUrl(companyVerificationLogId, company, {
    firstName: log.firstName,
    lastName: log.lastName,
  });

  await db
    .update(companyVerificationLog)
    .set({ status: "idVerificationRequested" })
    .where(eq(companyVerificationLog.id, companyVerificationLogId))
    .returning()
    .then((rows) => rows[0]);
  
  return verificationUrl;
}

async function createIdVerificationUrl(
  companyVerificationLogId: string,
  company: Company,
  expectedDetails?: {
    firstName?: string | null;
    lastName?: string | null;
  }
): Promise<string> {
  const baseUrl = getBaseUrlOrThrow();

  const callbackUrl = `${baseUrl}/company-verification/${companyVerificationLogId}/status`;
  const verificationUrl = await verifyCompany({
    companyVerificationLogId,
    company,
    callback: callbackUrl,
    expectedDetails,
  });
  if (!verificationUrl) {
    throw new UserFacingError("Failed to create verification session");
  }

  return verificationUrl;
}
