import { Text } from "@react-email/components";
import {
  EmailLayout,
  EmailHeading,
  InfoSection,
} from "@core/emails/components/shared";
import { DANGER } from "@core/lib/config/colors";

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
  sendOnly?: boolean;
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
  sendOnly = false,
}: ArratechKycReviewNotificationProps) => (
  <EmailLayout preview={`${companyName} requires onboarding review`}>
    <EmailHeading>Arratech onboarding requires review</EmailHeading>
    <Text className="mb-4">Hello,</Text>
    {submissionError ? (
      <Text className={`mb-4 text-[${DANGER}]`}>
        The identity of a representative of <strong>{companyName}</strong> was
        verified, but its platform onboarding needs attention. Review the error
        below and any attached mandate before taking action.
      </Text>
    ) : (
      <Text className="mb-4">
        The identity of a representative of <strong>{companyName}</strong> was
        verified and its KYC, including the mandate attached to this email, has
        been filed with Arratech.
      </Text>
    )}
    {sendOnly ? <Text className="mb-4">
      This send-only request needs manual follow-up with Arratech. Keep the session
      under review and inform the customer when there is an update. Do not enable
      receiving or approve KYC as a workaround.
    </Text> : <Text className="mb-4">
      Check the KYC metadata and signed mandate. An organisation admin can approve
      pending KYC via POST /kyc/approve. Arratech then completes Annuaire registration.
      Wait for the participant to become ACTIVE before completing the session
      through the admin API. An approved KYC alone is not sufficient.
    </Text>}
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
        <Text className={`my-1 text-sm text-[${DANGER}]`}>
          <strong>Submission error:</strong> {submissionError}
        </Text>
      ) : null}
    </InfoSection>
    {!sendOnly && <Text className="mb-4 text-sm">
      Complete the session with{" "}
      <code>
        POST /api/admin/companies/verification/{verificationLogId}/complete
      </code>{" "}
      and a status of <code>verified</code> or <code>rejected</code>.
    </Text>}
  </EmailLayout>
);

ArratechKycReviewNotification.PreviewProps = {
  companyName: "Acme SARL",
  companyId: "c_01JX",
  verificationLogId: "cvl_01JX",
  jurisdiction: "FR",
  identityRows: [{ label: "SIREN", value: "303265045" }],
  identityNotes: ["Confirm the establishment identifier before completing the review."],
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
    ? `Arratech onboarding needs attention for ${props.companyName}`
    : `Arratech onboarding review for ${props.companyName}`;
