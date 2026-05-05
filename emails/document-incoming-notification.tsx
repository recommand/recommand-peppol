import { Text } from "@react-email/components";
import {
  Button,
  EmailLayout,
  EmailHeading,
  InfoSection,
  Section,
} from "@core/emails/components/shared";

export interface DocumentIncomingNotificationProps {
  companyName: string;
  senderName: string;
  documentType: string;
  documentNumber?: string;
  amount?: string;
  currency?: string;
  documentUrl?: string;
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
}: DocumentIncomingNotificationProps) => (
  <EmailLayout
    preview={`New ${documentType.toLowerCase()} received from ${senderName}`}
  >
    <EmailHeading>New {documentType} Received</EmailHeading>
    <Text className="mb-4">
      Your company <strong>{companyName}</strong> has received a new{" "}
      {documentType.toLowerCase()} via the Peppol network.
    </Text>
    <InfoSection>
      <Text className="my-1">
        <strong>From:</strong> {senderName}
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
      The document and any attachments are included with this email. Please
      review and take any necessary action.
    </Text>
    {documentUrl ? (
      <Section className="my-6 text-center">
        <Button href={documentUrl}>Open document</Button>
      </Section>
    ) : null}
  </EmailLayout>
);

export const subject = (props: DocumentIncomingNotificationProps) => {
  if (props.documentNumber) {
    return `New ${props.documentType} received: ${props.documentNumber}`;
  }

  const eventPayload =
    props.event?.payload && typeof props.event.payload === "object"
      ? (props.event.payload as { docType?: string })
      : undefined;
  const eventDocumentType =
    eventPayload?.docType ?? props.documentType ?? "document";
  const aggregateId = props.event?.aggregateId;
  return `New ${eventDocumentType} received${aggregateId ? `: ${aggregateId}` : ""}`;
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
