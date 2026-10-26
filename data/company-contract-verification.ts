import { createHash } from "node:crypto";
import { isS3Enabled, uploadFile } from "@core/lib/s3";
import { companyVerificationLog } from "@peppol/db/schema";
import { db } from "@recommand/db";
import type { Company } from "@peppol/data/companies";
import { requiresArratechKycReview } from "./at/kyc";
import { assertCompanyIdentifiersAllowed } from "./company-identifiers";
import { lockCompanyRow, sameCompanyIdentity } from "./company-row-lock";
import { finalizeCompanyVerification } from "./company-verification";
import { getTeamExtension } from "./teams";
import { UserFacingError } from "@peppol/utils/util";

export type ContractVerificationResult =
  | { status: "alreadyVerified" }
  | {
      status: "verified" | "error";
      verificationLogId: string;
      contractSha256: string;
      contractStorageKey: string | null;
      errorMessage: string | null;
    };

export function contractProofReference(contractSha256: string): string {
  return `CONTRACT:sha256:${contractSha256}`;
}

function contractStorageKey(companyId: string, contractSha256: string): string {
  return `company-verification/${companyId}/contracts/${contractSha256}.pdf`;
}

export async function verifyCompanyByContract({
  company,
  contract,
}: {
  company: Company;
  contract: Uint8Array;
}): Promise<ContractVerificationResult> {
  if (company.isVerified) {
    return { status: "alreadyVerified" };
  }

  // Companies filed with Arratech need a mandate signed through the identity
  // check, which a contract cannot stand in for.
  if (await requiresArratechKycReview(company)) {
    throw new UserFacingError("This company cannot be verified by contract. Use the interactive verification instead.");
  }

  await assertCompanyIdentifiersAllowed(company, await getTeamExtension(company.teamId));

  const contractSha256 = createHash("sha256").update(contract).digest("hex");

  // Content-addressed, so a retried upload of the same contract overwrites the
  // object with identical bytes.
  let storageKey: string | null = null;
  if (isS3Enabled()) {
    storageKey = contractStorageKey(company.id, contractSha256);
    await uploadFile(storageKey, contract, { type: "application/pdf" });
  }

  const log = await db.transaction(async (tx) => {
    const current = await lockCompanyRow(tx, company.id, "share");
    if (!current || !sameCompanyIdentity(current, company)) {
      throw new UserFacingError("The company changed while it was being verified. Please try again.");
    }
    return await tx
      .insert(companyVerificationLog)
      .values({
        companyId: company.id,
        companyName: company.name,
        enterpriseNumber: company.enterpriseNumber,
        address: company.address,
        postalCode: company.postalCode,
        city: company.city,
        country: company.country,
      })
      .returning()
      .then((rows) => rows[0]);
  });

  const result = await finalizeCompanyVerification({
    companyVerificationLogId: log.id,
    company,
    status: "verified",
    verificationProofReference: contractProofReference(contractSha256),
  });

  return {
    status: result.status === "verified" ? "verified" : "error",
    verificationLogId: log.id,
    contractSha256,
    contractStorageKey: storageKey,
    errorMessage: result.errorMessage,
  };
}
