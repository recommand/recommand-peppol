import { Text } from "@react-email/components";
import {
  Button,
  EmailHeading,
  EmailLayout,
  InfoSection,
  Section,
} from "@core/emails/components/shared";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

type VerificationStatus = "verified" | "rejected" | "error";

type Props = {
  companyName?: string;
  companyUrl?: string | null;
  t?: TranslationFunction;
  event: {
    payload?: {
      companyId?: string;
      status?: VerificationStatus;
      errorMessage?: string | null;
    };
  };
};

/**
 * The payload carries the raw enum value, which is not a translation key.
 */
function statusLabel(t: TranslationFunction, status: VerificationStatus | undefined) {
  switch (status) {
    case "verified":
      return t`Verified`;
    case "rejected":
      return t`Rejected`;
    case "error":
      return t`Error`;
    default:
      return t`Updated`;
  }
}

export const subject = (props: Props) => {
  const t = props.t ?? fallbackT;
  const payload = props.event.payload;
  const company = props.companyName ?? payload?.companyId ?? t`Unknown`;
  return t`Company verification ${statusLabel(t, payload?.status)}: ${company}`;
};

export default function CompanyVerificationNotification(props: Props) {
  const t = props.t ?? fallbackT;
  const payload = props.event.payload;
  const companyName = props.companyName ?? payload?.companyId ?? t`Unknown`;
  const status = statusLabel(t, payload?.status);

  return (
    <EmailLayout
      preview={t`Company verification status for ${companyName}: ${status}`}
      t={t}
    >
      <EmailHeading>{t`Company verification update`}</EmailHeading>
      <Text className="mb-4">
        {t`A company verification update was recorded for ${companyName}.`}
      </Text>
      <InfoSection>
        <Text className="my-1"><strong>{t`Company`}:</strong> {companyName}</Text>
        <Text className="my-1"><strong>{t`Status`}:</strong> {status}</Text>
        {payload?.errorMessage ? (
          <Text className="my-1"><strong>{t`Error`}:</strong> {payload.errorMessage}</Text>
        ) : null}
      </InfoSection>
      {props.companyUrl ? (
        <Section className="my-6 text-center">
          <Button href={props.companyUrl}>{t`Open company`}</Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}
