import { Text } from "@react-email/components";
import {
  Button,
  EmailLayout,
  EmailHeading,
  InfoSection,
  Section,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

export interface DocumentIncomingNotificationProps {
  companyName: string;
  senderName: string;
  documentType: string;
  documentNumber?: string;
  amount?: string;
  currency?: string;
  documentUrl?: string;
  t?: TranslationFunction;
  event?: {
    aggregateId: string;
    payload?: unknown;
  };
}

export const DocumentIncomingNotification = ({
  companyName,
  senderName,
  documentType,
  documentNumber,
  amount,
  currency,
  documentUrl,
  t = fallbackT,
}: DocumentIncomingNotificationProps) => {
  // documentType arrives as its English label, which is also its translation
  // key. It is never lower-cased mid-sentence: German capitalises every noun.
  const typeLabel = t(documentType);

  return (
    <EmailLayout
      preview={t`New ${typeLabel} received from ${senderName}`}
      t={t}
    >
      <EmailHeading>{t`New ${typeLabel} received`}</EmailHeading>
      <Text className="mb-4">
        {t`Your company ${companyName} has received a new ${typeLabel} via the Peppol network.`}
      </Text>
      <InfoSection>
        <Text className="my-1">
          <strong>{t`From`}:</strong> {senderName}
        </Text>
        {documentNumber && (
          <Text className="my-1">
            <strong>{t`Document number`}:</strong> {documentNumber}
          </Text>
        )}
        {amount && currency && (
          <Text className="my-1">
            <strong>{t`Amount`}:</strong> {amount} {currency}
          </Text>
        )}
      </InfoSection>
      <Text className="mb-4">
        {t`The document and any attachments are included with this email. Please review and take any necessary action.`}
      </Text>
      {documentUrl ? (
        <Section className="my-6 text-center">
          <Button href={documentUrl}>{t`Open document`}</Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
};

export const subject = (props: DocumentIncomingNotificationProps) => {
  const t = props.t ?? fallbackT;
  const typeLabel = t(props.documentType);
  const reference = props.documentNumber ?? props.event?.aggregateId;

  return reference
    ? t`New ${typeLabel} received: ${reference}`
    : t`New ${typeLabel} received`;
};

DocumentIncomingNotification.PreviewProps = {
  companyName: "Acme Corporation",
  senderName: "Supplier Ltd.",
  documentType: "Invoice",
  documentNumber: "INV-2024-001",
  amount: "1,250.00",
  currency: "EUR",
  documentUrl: "https://app.recommand.eu/transmitted-documents/doc_123",
} as DocumentIncomingNotificationProps;

export default DocumentIncomingNotification;
