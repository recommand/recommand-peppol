import { companyVerificationLog } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import type { Company } from "@peppol/data/companies";
import {
  getCompanyVerificationLog,
  isFinalVerificationStatus,
  type CompanyVerificationStatus,
} from "@peppol/data/company-verification";
import { sendArratechKycReviewEmail } from "@peppol/data/send-arratech-kyc-review-email";
import { upsertCompanyRegistrations } from "@peppol/data/smp-providers";
import { getTeamExtension } from "@peppol/data/teams";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { UserFacingError } from "@directory/utils/util";
import {
  buildArratechKycFiling,
  submitArratechCompanyKyc,
  type ArratechKycFiling,
} from "./kyc";

export async function startArratechKycReview({
  companyVerificationLogId,
  company,
  verificationProofReference,
}: {
  companyVerificationLogId: string;
  company: Company;
  verificationProofReference: string;
}): Promise<{ status: CompanyVerificationStatus }> {
  const existingLog = await getCompanyVerificationLog(companyVerificationLogId);
  if (!existingLog) {
    throw new UserFacingError("Company verification log not found");
  }
  if (isFinalVerificationStatus(existingLog.status)) {
    return { status: existingLog.status };
  }
  const teamExtension = await getTeamExtension(company.teamId);
  if (company.country === "FR" && company.smpProvider === "at-shared-smp-fr" && !teamExtension?.useTestNetwork && !teamExtension?.isPlayground) {
    const now = new Date().toISOString();
    await db.update(companyVerificationLog).set({
      status: "inReview", verificationProofReference, errorMessage: null,
      arratechOnboarding: { phase: "submit", attempts: 0, startedAt: now, nextAttemptAt: now },
    }).where(and(eq(companyVerificationLog.id, companyVerificationLogId),
      isNull(companyVerificationLog.arratechOnboarding),
      inArray(companyVerificationLog.status, ["opened", "idVerificationRequested", "inReview"])));
    return { status: (await getCompanyVerificationLog(companyVerificationLogId))!.status };
  }
  // The same identity verification must not be filed with Arratech twice.
  if (
    existingLog.status === "inReview" &&
    existingLog.verificationProofReference === verificationProofReference
  ) {
    return { status: existingLog.status };
  }

  const useTestNetwork = teamExtension?.useTestNetwork ?? false;
  const smpStateBase = {
    isPlayground: teamExtension?.isPlayground,
    useTestNetwork,
    isSmpRecipient: company.isSmpRecipient,
    verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
  };

  await db
    .update(companyVerificationLog)
    .set({
      status: "inReview",
      verificationProofReference,
      errorMessage: null,
    })
    .where(eq(companyVerificationLog.id, companyVerificationLogId));

  const isRegistered = shouldRegisterWithSmp({ ...smpStateBase, isVerified: company.isVerified });
  const shouldBeRegistered = shouldRegisterWithSmp({ ...smpStateBase, isVerified: true });

  let filing: ArratechKycFiling | null = null;
  let submissionError: string | null = null;

  try {
    if (!existingLog.firstName || !existingLog.lastName) {
      throw new UserFacingError(
        "Verification log has no representative name to sign the mandate with"
      );
    }

    if (!isRegistered && shouldBeRegistered) {
      await upsertCompanyRegistrations({
        companyId: company.id,
        useTestNetwork,
        includeCapabilities: useTestNetwork,
      });
    }

    filing = await buildArratechKycFiling({
      company,
      signatory: {
        firstName: existingLog.firstName,
        lastName: existingLog.lastName,
      },
      // The mandate carries the moment the representative signed it, not the
      // moment their identity check came back.
      signedAt: existingLog.mandateAcceptedAt ?? new Date(),
      proofReference: verificationProofReference,
      reference: existingLog.id,
    });

    await submitArratechCompanyKyc({
      companyId: company.id,
      filing,
      useTestNetwork,
    });
  } catch (error) {
    // Support still gets the follow-up email, with whatever we managed to build,
    // so the KYC can be filed by hand instead of the session going stale.
    submissionError = error instanceof Error ? error.message : String(error);
    console.error(`Failed to submit Arratech KYC for company ${company.id}:`, error);
    await sendSystemAlert(
      "Arratech KYC submission failed",
      `Could not submit the KYC for company ${company.name} (${company.id}), verification ${existingLog.id}: ${submissionError}`,
      "error"
    );
  }

  await sendArratechKycReviewEmail({
    companyName: company.name,
    companyId: company.id,
    verificationLogId: existingLog.id,
    jurisdiction: filing?.jurisdiction ?? company.country,
    identityRows: filing?.identity.rows,
    identityNotes: filing?.identity.notes,
    electronicAddresses: filing?.electronicAddresses,
    signatoryName: filing?.signatoryName,
    useTestNetwork,
    mandate: filing?.mandate,
    mandateFileName: filing?.mandateFileName,
    submissionError,
  });

  return { status: "inReview" };
}
