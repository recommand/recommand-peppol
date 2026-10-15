import { Section, Text } from "@react-email/components";
import {
  Button,
  EmailLayout,
  EmailHeading,
  InfoSection,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface CompanyVerificationRejectedNotificationProps {
  companyName: string;
  reason?: string | null;
  verificationUrl?: string | null;
  t?: TranslationFunction;
}

export const CompanyVerificationRejectedNotification = ({
  companyName = "Acme Corp",
  reason,
  verificationUrl,
  t = fallbackT,
}: CompanyVerificationRejectedNotificationProps) => (
  <EmailLayout
    preview={t`${companyName} could not be verified on the Peppol network`}
    t={t}
  >
    <EmailHeading>{t`Company verification declined`}</EmailHeading>
    <Text className="mb-4">{t`Hello,`}</Text>
    <Text className="mb-4">
      {t`The manual verification for ${companyName} was declined.`}
    </Text>
    {reason ? (
      <InfoSection>
        <Text className="my-1"><strong>{t`Reason`}:</strong></Text>
        <Text className="my-1 whitespace-pre-line">{reason}</Text>
      </InfoSection>
    ) : null}
    {verificationUrl ? (
      <>
        <Text className="mb-4">
          {t`This company is not active on the Peppol network yet. You can start a new verification with the link below.`}
        </Text>
        <Section className="my-6 text-center">
          <Button variant="primary" href={verificationUrl}>
            {t`Verify again`}
          </Button>
        </Section>
      </>
    ) : (
      <Text className="mb-4">
        {t`This company is not active on the Peppol network yet. Please contact us if you believe this decision needs to be reviewed.`}
      </Text>
    )}
    <InfoSection>
      <Text className="my-1 text-sm">
        {t`If you have any questions, contact`}{" "}
        <a href="mailto:support@recommand.eu">support@recommand.eu</a>.
      </Text>
    </InfoSection>
  </EmailLayout>
);

CompanyVerificationRejectedNotification.PreviewProps = {
  companyName: "Acme Corp",
  reason: "The uploaded identity document has expired. Please verify again with a valid document.",
  verificationUrl: "https://app.recommand.eu/company-verification/example/verify",
} as CompanyVerificationRejectedNotificationProps;

export default CompanyVerificationRejectedNotification;

export const subject = (props: {
  companyName: string;
  t?: TranslationFunction;
}) => {
  const t = props.t ?? fallbackT;
  return t`${props.companyName} verification was declined`;
};
