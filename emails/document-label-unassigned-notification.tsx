import { Text } from "@react-email/components";
import {
  Button,
  EmailHeading,
  EmailLayout,
  InfoSection,
  Section,
} from "@core/emails/components/shared";

type Props = {
  companyName?: string;
  labelName?: string;
  labelExternalId?: string | null;
  documentType?: string;
  documentNumber?: string;
  documentUrl?: string;
  event: {
    aggregateId: string;
    payload?: {
      labelExternalId?: string | null;
      labelId?: string;
      companyId?: string;
      docType?: string;
    };
  };
};

export const subject = (props: Props) =>
  `Label removed: ${props.labelName ?? "Label"} from ${props.documentNumber ?? props.event.aggregateId}`.trim();

export default function DocumentLabelUnassignedNotification(props: Props) {
  const payload = props.event.payload;
  const aggregateId = props.event.aggregateId;
  const companyName = props.companyName ?? payload?.companyId ?? "Unknown";
  const labelName =
    props.labelName ?? payload?.labelExternalId ?? payload?.labelId ?? "Unknown";
  const documentType = props.documentType ?? payload?.docType ?? "Document";
  const documentReference = props.documentNumber ?? aggregateId;
  const showExternalId =
    props.labelExternalId && props.labelExternalId !== labelName;

  return (
    <EmailLayout preview={`${labelName} was removed from ${documentType.toLowerCase()} ${documentReference}`}>
      <EmailHeading>Label removed from document</EmailHeading>
      <Text className="mb-4">
        The label <strong>{labelName}</strong> was removed from a{" "}
        {documentType.toLowerCase()} for <strong>{companyName}</strong>.
      </Text>
      <InfoSection>
        <Text className="my-1"><strong>Company:</strong> {companyName}</Text>
        <Text className="my-1"><strong>Label:</strong> {labelName}</Text>
        {showExternalId ? (
          <Text className="my-1"><strong>Label external ID:</strong> {props.labelExternalId}</Text>
        ) : null}
        <Text className="my-1"><strong>Document type:</strong> {documentType}</Text>
        {props.documentNumber ? (
          <Text className="my-1"><strong>Document number:</strong> {props.documentNumber}</Text>
        ) : null}
        <Text className="my-1"><strong>Document ID:</strong> {aggregateId}</Text>
      </InfoSection>
      {props.documentUrl ? (
        <Section className="my-6 text-center">
          <Button href={props.documentUrl}>Open document</Button>
        </Section>
      ) : null}
      <Text className="mb-0">
        Open the document in Recommand to review the current labels and any follow-up actions.
      </Text>
    </EmailLayout>
  );
}
