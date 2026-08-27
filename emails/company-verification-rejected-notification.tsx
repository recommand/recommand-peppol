import { Text } from "@react-email/components";
import {
  EmailLayout,
  EmailHeading,
  InfoSection,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface CompanyVerificationRejectedNotificationProps {
  companyName: string;
  t?: TranslationFunction;
}

export const CompanyVerificationRejectedNotification = ({
  companyName = "Acme Corp",
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
    <Text className="mb-4">
      {t`This company is not active on the Peppol network yet. Please contact us if you believe this decision needs to be reviewed.`}
    </Text>
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
} as CompanyVerificationRejectedNotificationProps;

export default CompanyVerificationRejectedNotification;

export const subject = (props: {
  companyName: string;
  t?: TranslationFunction;
}) => {
  const t = props.t ?? fallbackT;
  return t`${props.companyName} verification was declined`;
};
