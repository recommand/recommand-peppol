import { Text } from "@react-email/components";
import {
  Button,
  EmailLayout,
  EmailHeading,
  InfoSection,
  Section,
} from "@core/emails/components/shared";

export interface DocumentOutgoingNotificationProps {
  companyName: string;
  recipientName: string;
  documentType: string;
  documentNumber?: string;
  amount?: string;
  currency?: string;
  documentUrl?: string;
}

export const DocumentOutgoingNotification = ({
  companyName,
  recipientName,
  documentType,
  documentNumber,
  amount,
  currency,
  documentUrl,
}: DocumentOutgoingNotificationProps) => (
  <EmailLayout preview={`${documentType} sent to ${recipientName}`}>
    <EmailHeading>{documentType} Sent</EmailHeading>
    <Text className="mb-4">
      Your company <strong>{companyName}</strong> has successfully sent a{" "}
      {documentType.toLowerCase()} via the Peppol network.
    </Text>
    <InfoSection>
      <Text className="my-1">
        <strong>To:</strong> {recipientName}
      </Text>
      {documentNumber && (
        <Text className="my-1">
          <strong>Document Number:</strong> {documentNumber}
        </Text>
      )}
      {amount && currency && (
        <Text className="my-1">
          <strong>Amount:</strong> {amount} {currency}
        </Text>
      )}
    </InfoSection>
    <Text className="mb-4">
      The {documentType.toLowerCase()} has been delivered to the recipient
      through the Peppol network. The document and any attachments are included
      with this email for your records.
    </Text>
    {documentUrl ? (
      <Section className="my-6 text-center">
        <Button href={documentUrl}>Open document</Button>
      </Section>
    ) : null}
  </EmailLayout>
);

export const subject = (props: DocumentOutgoingNotificationProps) => {
  if (props.documentNumber) {
    return `${props.documentType} sent successfully: ${props.documentNumber}`;
  }

  return `${props.documentType} sent successfully${props.recipientName ? `: ${props.recipientName}` : ""}`;
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
