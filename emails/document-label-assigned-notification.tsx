import { Text } from "@react-email/components";
import {
  Button,
  EmailHeading,
  EmailLayout,
  InfoSection,
  Section,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

type Props = {
  companyName?: string;
  labelName?: string;
  labelExternalId?: string | null;
  documentType?: string;
  documentNumber?: string;
  documentUrl?: string;
  t?: TranslationFunction;
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

export const subject = (props: Props) => {
  const t = props.t ?? fallbackT;
  const labelName = props.labelName ?? t`Label`;
  const documentReference = props.documentNumber ?? props.event.aggregateId;
  return t`Label assigned: ${labelName} on ${documentReference}`;
};

export default function DocumentLabelAssignedNotification(props: Props) {
  const t = props.t ?? fallbackT;
  const payload = props.event.payload;
  const aggregateId = props.event.aggregateId;
  const companyName = props.companyName ?? payload?.companyId ?? t`Unknown`;
  const labelName =
    props.labelName ?? payload?.labelExternalId ?? payload?.labelId ?? t`Unknown`;
  // documentType arrives as its English label, which is also its translation key.
  const documentType = t(props.documentType ?? t`Document`);
  const documentReference = props.documentNumber ?? aggregateId;
  const showExternalId =
    props.labelExternalId && props.labelExternalId !== labelName;

  return (
    <EmailLayout
      preview={t`${labelName} was assigned to ${documentType} ${documentReference}`}
      t={t}
    >
      <EmailHeading>{t`Label assigned to document`}</EmailHeading>
      <Text className="mb-4">
        {t`The label ${labelName} was assigned to a ${documentType} for ${companyName}.`}
      </Text>
      <InfoSection>
        <Text className="my-1"><strong>{t`Company`}:</strong> {companyName}</Text>
        <Text className="my-1"><strong>{t`Label`}:</strong> {labelName}</Text>
        {showExternalId ? (
          <Text className="my-1"><strong>{t`Label external ID`}:</strong> {props.labelExternalId}</Text>
        ) : null}
        <Text className="my-1"><strong>{t`Document type`}:</strong> {documentType}</Text>
        {props.documentNumber ? (
          <Text className="my-1"><strong>{t`Document number`}:</strong> {props.documentNumber}</Text>
        ) : null}
        <Text className="my-1"><strong>{t`Document ID`}:</strong> {aggregateId}</Text>
      </InfoSection>
      {props.documentUrl ? (
        <Section className="my-6 text-center">
          <Button href={props.documentUrl}>{t`Open document`}</Button>
        </Section>
      ) : null}
      <Text className="mb-0">
        {t`Open the document in Recommand to review the label assignment and continue processing it.`}
      </Text>
    </EmailLayout>
  );
}
