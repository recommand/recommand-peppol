import { Text } from "@react-email/components";
import {
  EmailLayout,
  EmailHeading,
  InfoSection,
  baseUrl,
  Button,
} from "@core/emails/components/shared";
import { Section } from "@react-email/components";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface CompanyVerifiedNotificationProps {
  companyName: string;
  t?: TranslationFunction;
}

export const CompanyVerifiedNotification = ({
  companyName = "Acme Corp",
  t = fallbackT,
}: CompanyVerifiedNotificationProps) => (
  <EmailLayout
    preview={t`${companyName} has been verified on the Peppol network`}
    t={t}
  >
    <EmailHeading>{t`Company verified`}</EmailHeading>
    <Text className="mb-4">{t`Hello,`}</Text>
    <Text className="mb-4">
      {t`Great news! ${companyName} has been manually verified and is now active on the Peppol network.`}
    </Text>
    <Text className="mb-4">
      {t`You can now send and receive electronic documents through Peppol.`}
    </Text>
    <Section className="my-6 text-center">
      <Button variant="primary" href={`${baseUrl}/companies`}>
        {t`Go to your companies`}
      </Button>
    </Section>
    <InfoSection>
      <Text className="my-1 text-sm">
        {t`If you have any questions, contact`}{" "}
        <a href="mailto:support@recommand.eu">support@recommand.eu</a>.
      </Text>
    </InfoSection>
  </EmailLayout>
);

CompanyVerifiedNotification.PreviewProps = {
  companyName: "Acme Corp",
} as CompanyVerifiedNotificationProps;

export default CompanyVerifiedNotification;

export const subject = (props: {
  companyName: string;
  t?: TranslationFunction;
}) => {
  const t = props.t ?? fallbackT;
  return t`${props.companyName} has been verified on the Peppol network`;
};
