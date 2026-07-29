import { Text } from "@react-email/components";
import {
  EmailLayout,
  EmailHeading,
  InfoSection,
} from "@core/emails/components/shared";

interface ArratechKycReviewNotificationProps {
  companyName: string;
  companyId: string;
  verificationLogId: string;
  jurisdiction: string;
  identityRows?: { label: string; value: string }[];
  identityNotes?: string[];
  electronicAddresses?: string[];
  signatoryName?: string;
  network: "production" | "test";
  submissionError?: string | null;
}

export const ArratechKycReviewNotification = ({
  companyName = "Acme SARL",
  companyId = "c_01",
  verificationLogId = "cvl_01",
  jurisdiction = "FR",
  identityRows = [],
  identityNotes = [],
  electronicAddresses = [],
  signatoryName,
  network = "production",
  submissionError = null,
}: ArratechKycReviewNotificationProps) => (
  <EmailLayout preview={`${companyName} is waiting for Arratech to accept its KYC`}>
    <EmailHeading>Arratech KYC awaiting acceptance</EmailHeading>
    <Text className="mb-4">Hello,</Text>
    {submissionError ? (
      <Text className="mb-4">
        The identity of a representative of <strong>{companyName}</strong> was
        verified, but filing its KYC with Arratech failed. The mandate is
        attached to this email and has to be filed manually.
      </Text>
    ) : (
      <Text className="mb-4">
        The identity of a representative of <strong>{companyName}</strong> was
        verified and its KYC, including the mandate attached to this email, has
        been filed with Arratech.
      </Text>
    )}
    <Text className="mb-4">
      The verification session stays under review until Arratech accepts the
      company. Once they confirm, complete the session through the admin API so
      the company is marked as verified.
    </Text>
    <InfoSection>
      <Text className="my-1 text-sm">
        <strong>Company:</strong> {companyName} ({companyId})
      </Text>
      <Text className="my-1 text-sm">
        <strong>Verification session:</strong> {verificationLogId}
      </Text>
      {signatoryName ? (
        <Text className="my-1 text-sm">
          <strong>Signatory:</strong> {signatoryName}
        </Text>
      ) : null}
      {identityRows.map((row) => (
        <Text className="my-1 text-sm" key={row.label}>
          <strong>{row.label}:</strong> {row.value}
        </Text>
      ))}
      {identityNotes.map((note) => (
        <Text className="my-1 text-sm" key={note}>
          <strong>Note:</strong> {note}
        </Text>
      ))}
      {electronicAddresses.length > 0 ? (
        <Text className="my-1 text-sm">
          <strong>Electronic addresses:</strong>{" "}
          {electronicAddresses.join(", ")}
        </Text>
      ) : null}
      <Text className="my-1 text-sm">
        <strong>Jurisdiction:</strong> {jurisdiction}
      </Text>
      <Text className="my-1 text-sm">
        <strong>Network:</strong> {network}
      </Text>
      {submissionError ? (
        <Text className="my-1 text-sm">
          <strong>Submission error:</strong> {submissionError}
        </Text>
      ) : null}
    </InfoSection>
    <Text className="mb-4 text-sm">
      Complete the session with{" "}
      <code>
        POST /api/admin/companies/verification/{verificationLogId}/complete
      </code>{" "}
      and a status of <code>verified</code> or <code>rejected</code>.
    </Text>
  </EmailLayout>
);

ArratechKycReviewNotification.PreviewProps = {
  companyName: "Acme SARL",
  companyId: "c_01JX",
  verificationLogId: "cvl_01JX",
  jurisdiction: "FR",
  identityRows: [{ label: "SIREN", value: "303265045" }],
  identityNotes: [
    "SIRET 30326504500001 assumed to be the head office, the company only gave us its SIREN",
  ],
  electronicAddresses: ["0225:303265045"],
  signatoryName: "Jeanne Durand",
  network: "production",
  submissionError: null,
} as ArratechKycReviewNotificationProps;

export default ArratechKycReviewNotification;

export const subject = (props: {
  companyName: string;
  submissionError?: string | null;
}) =>
  props.submissionError
    ? `Arratech KYC submission failed for ${props.companyName}`
    : `Arratech KYC awaiting acceptance for ${props.companyName}`;
