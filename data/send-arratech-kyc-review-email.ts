import { sendEmail } from "@core/lib/email";
import {
  ArratechKycReviewNotification,
  subject as kycReviewSubject,
} from "@peppol/emails/arratech-kyc-review-notification";
import React from "react";

const SUPPORT_EMAIL_ADDRESS = "support@recommand.eu";

/**
 * Tells support that a company is waiting for Arratech to accept its KYC, so
 * the verification session can be completed manually afterwards.
 */
export async function sendArratechKycReviewEmail({
  companyName,
  companyId,
  verificationLogId,
  jurisdiction,
  identityRows,
  identityNotes,
  electronicAddresses,
  signatoryName,
  useTestNetwork,
  mandate,
  mandateFileName,
  submissionError,
}: {
  companyName: string;
  companyId: string;
  verificationLogId: string;
  jurisdiction: string;
  identityRows?: { label: string; value: string }[];
  identityNotes?: string[];
  electronicAddresses?: string[];
  signatoryName?: string;
  useTestNetwork: boolean;
  mandate?: Buffer;
  mandateFileName?: string;
  submissionError?: string | null;
}): Promise<void> {
  try {
    await sendEmail({
      to: SUPPORT_EMAIL_ADDRESS,
      subject: kycReviewSubject({ companyName, submissionError }),
      email: React.createElement(ArratechKycReviewNotification, {
        companyName,
        companyId,
        verificationLogId,
        jurisdiction,
        identityRows,
        identityNotes,
        electronicAddresses,
        signatoryName,
        network: useTestNetwork ? "test" : "production",
        submissionError,
      }),
      attachments:
        mandate && mandateFileName
          ? [
              {
                Name: mandateFileName,
                Content: mandate.toString("base64"),
                ContentType: "application/pdf",
                ContentID: "",
              },
            ]
          : undefined,
    });
  } catch (error) {
    console.error(
      `Failed to send Arratech KYC review email for company ${companyId}:`,
      error
    );
  }
}
