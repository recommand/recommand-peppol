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
  /**
   * How the document left the platform. Reports are filed with a tax
   * administration instead of being transmitted over the Peppol network.
   */
  channel?: "peppol" | "reporting";
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
}: DocumentOutgoingNotificationProps) => {
  const isReport = channel === "reporting";

  return (
    <EmailLayout
      preview={
        isReport
          ? `${documentType} filed with ${recipientName}`
          : `${documentType} sent to ${recipientName}`
      }
    >
      <EmailHeading>
        {documentType} {isReport ? "Filed" : "Sent"}
      </EmailHeading>
      <Text className="mb-4">
        Your company <strong>{companyName}</strong> has successfully{" "}
        {isReport
          ? `filed a ${documentType.toLowerCase()} with the ${recipientName.toLowerCase()}.`
          : `sent a ${documentType.toLowerCase()} via the Peppol network.`}
      </Text>
      <InfoSection>
        <Text className="my-1">
          <strong>To:</strong> {recipientName}
        </Text>
        {documentNumber && (
          <Text className="my-1">
            <strong>{isReport ? "Reference" : "Document Number"}:</strong>{" "}
            {documentNumber}
          </Text>
        )}
        {amount && currency && (
          <Text className="my-1">
            <strong>Amount:</strong> {amount} {currency}
          </Text>
        )}
      </InfoSection>
      <Text className="mb-4">
        {isReport
          ? `The ${documentType.toLowerCase()} has been accepted for processing by our approved reporting partner. The reported data is included with this email for your records.`
          : `The ${documentType.toLowerCase()} has been delivered to the recipient through the Peppol network. The document and any attachments are included with this email for your records.`}
      </Text>
      {documentUrl ? (
        <Section className="my-6 text-center">
          <Button href={documentUrl}>
            {isReport ? "Open report" : "Open document"}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
};

export const subject = (props: DocumentOutgoingNotificationProps) => {
  const action = props.channel === "reporting" ? "filed" : "sent";
  if (props.documentNumber) {
    return `${props.documentType} ${action} successfully: ${props.documentNumber}`;
  }

  return `${props.documentType} ${action} successfully${props.recipientName ? `: ${props.recipientName}` : ""}`;
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
