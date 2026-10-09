import { Text } from "@react-email/components";
import { EmailLayout, EmailHeading, InfoSection } from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface ReceiverRegistrationRemovedNotificationProps {
  companyName: string;
  identifier: string;
  deletedOn: string;
  t?: TranslationFunction;
}

export const ReceiverRegistrationRemovedNotification = ({
  companyName = "Acme AS",
  identifier = "0192:123456785",
  deletedOn = "2026-10-08",
  t = fallbackT,
}: ReceiverRegistrationRemovedNotificationProps) => (
  <EmailLayout
    preview={t`${identifier} of ${companyName} can no longer receive documents over Peppol`}
    t={t}
  >
    <EmailHeading>{t`Peppol registration removed`}</EmailHeading>
    <Text className="mb-4">{t`Hello,`}</Text>
    <Text className="mb-4">
      {t`The organisation number ${identifier} of ${companyName} was deleted from Enhetsregisteret, the Norwegian register of legal entities, on ${deletedOn}.`}
    </Text>
    <Text className="mb-4">
      {t`The Peppol rules for Norway require the registration of a deleted organisation to be removed. We have removed ${identifier} from the Peppol network and from the company, so documents can no longer be delivered to it.`}
    </Text>
    <InfoSection>
      <Text className="my-1 text-sm">
        {t`If you think this is a mistake, contact`}{" "}
        <a href="mailto:support@recommand.eu">support@recommand.eu</a>.
      </Text>
    </InfoSection>
  </EmailLayout>
);

ReceiverRegistrationRemovedNotification.PreviewProps = {
  companyName: "Acme AS",
  identifier: "0192:123456785",
  deletedOn: "2026-10-08",
} as ReceiverRegistrationRemovedNotificationProps;

export default ReceiverRegistrationRemovedNotification;

export const subject = (props: {
  companyName: string;
  t?: TranslationFunction;
}) => {
  const t = props.t ?? fallbackT;
  return t`Peppol registration removed for ${props.companyName}`;
};
