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
  companyUrl?: string | null;
  event: {
    payload?: {
      companyId?: string;
      status?: "verified" | "rejected" | "error";
      errorMessage?: string | null;
    };
  };
};

export const subject = (props: Props) => {
  const payload = props.event.payload;
  const status = payload?.status ?? "updated";
  return `Company verification ${status}: ${props.companyName ?? payload?.companyId ?? "Unknown"}`;
};

export default function CompanyVerificationNotification(props: Props) {
  const payload = props.event.payload;
  const companyName = props.companyName ?? payload?.companyId ?? "Unknown";
  const statusLabel = payload?.status ?? "updated";

  return (
    <EmailLayout preview={`Company verification status for ${companyName}: ${statusLabel}`}>
      <EmailHeading>Company verification update</EmailHeading>
      <Text className="mb-4">
        A company verification update was recorded for <strong>{companyName}</strong>.
      </Text>
      <InfoSection>
        <Text className="my-1"><strong>Company:</strong> {companyName}</Text>
        <Text className="my-1"><strong>Status:</strong> {statusLabel}</Text>
        {payload?.errorMessage ? (
          <Text className="my-1"><strong>Error:</strong> {payload.errorMessage}</Text>
        ) : null}
      </InfoSection>
      {props.companyUrl ? (
        <Section className="my-6 text-center">
          <Button href={props.companyUrl}>Open company</Button>
        </Section>
      ) : null}
    </EmailLayout>
  );
}
