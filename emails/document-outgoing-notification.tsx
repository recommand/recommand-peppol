import { Text } from "@react-email/components";
import {
  Button,
  EmailLayout,
  EmailHeading,
  InfoSection,
  Section,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

export interface DocumentOutgoingNotificationProps {
  companyName: string;
  recipientName: string;
  documentType: string;
  documentNumber?: string;
  amount?: string;
  currency?: string;
  documentUrl?: string;
  /**
   * How the document left the platform. Reports are filed with a tax
   * administration instead of being transmitted over the Peppol network.
   */
  channel?: "peppol" | "reporting";
  t?: TranslationFunction;
}

export const DocumentOutgoingNotification = ({
  companyName,
  recipientName,
  documentType,
  documentNumber,
  amount,
  currency,
  documentUrl,
  channel = "peppol",
  t = fallbackT,
}: DocumentOutgoingNotificationProps) => {
  const isReport = channel === "reporting";
  // documentType arrives as its English label, which is also its translation
  // key. It is never lower-cased mid-sentence: German capitalises every noun.
  const typeLabel = t(documentType);

  return (
    <EmailLayout
      preview={
        isReport
          ? t`${typeLabel} filed with ${recipientName}`
          : t`${typeLabel} sent to ${recipientName}`
      }
      t={t}
    >
      <EmailHeading>
        {isReport ? t`${typeLabel} filed` : t`${typeLabel} sent`}
      </EmailHeading>
      <Text className="mb-4">
        {isReport
          ? t`Your company ${companyName} has successfully filed a ${typeLabel} with the ${recipientName}.`
          : t`Your company ${companyName} has successfully sent a ${typeLabel} via the Peppol network.`}
      </Text>
      <InfoSection>
        <Text className="my-1">
          <strong>{t`To`}:</strong> {recipientName}
        </Text>
        {documentNumber && (
          <Text className="my-1">
            <strong>{isReport ? t`Reference` : t`Document number`}:</strong>{" "}
            {documentNumber}
          </Text>
        )}
        {amount && currency && (
          <Text className="my-1">
            <strong>{t`Amount`}:</strong> {amount} {currency}
          </Text>
        )}
      </InfoSection>
      <Text className="mb-4">
        {isReport
          ? t`The ${typeLabel} has been accepted for processing by our approved reporting partner. The reported data is included with this email for your records.`
          : t`The ${typeLabel} has been delivered to the recipient through the Peppol network. The document and any attachments are included with this email for your records.`}
      </Text>
      {documentUrl ? (
        <Section className="my-6 text-center">
          <Button href={documentUrl}>
            {isReport ? t`Open report` : t`Open document`}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
};

export const subject = (props: DocumentOutgoingNotificationProps) => {
  const t = props.t ?? fallbackT;
  const typeLabel = t(props.documentType);
  const isReport = props.channel === "reporting";

  if (props.documentNumber) {
    return isReport
      ? t`${typeLabel} filed successfully: ${props.documentNumber}`
      : t`${typeLabel} sent successfully: ${props.documentNumber}`;
  }

  if (props.recipientName) {
    return isReport
      ? t`${typeLabel} filed successfully with ${props.recipientName}`
      : t`${typeLabel} sent successfully to ${props.recipientName}`;
  }

  return isReport
    ? t`${typeLabel} filed successfully`
    : t`${typeLabel} sent successfully`;
};

DocumentOutgoingNotification.PreviewProps = {
  companyName: "Acme Corporation",
  recipientName: "Customer Inc.",
  documentType: "Invoice",
  documentNumber: "INV-2024-001",
  amount: "1,250.00",
  currency: "EUR",
  documentUrl: "https://app.recommand.eu/transmitted-documents/doc_123",
} as DocumentOutgoingNotificationProps;

export default DocumentOutgoingNotification;
