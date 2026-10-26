import { Text } from "@react-email/components";
import { EmailLayout, EmailHeading, InfoSection } from "@core/emails/components/shared";

// Sent to support only, so it is not translated.

interface NorwegianVerificationReviewNotificationProps {
  companyName: string;
  companyId: string;
  teamId: string;
  sessionId: string;
  organisationNumber: string;
  representativeName: string;
  finding: string;
}

export const NorwegianVerificationReviewNotification = ({
  companyName = "Nordlys Handel AS",
  companyId = "c_01EXAMPLE",
  teamId = "team_01EXAMPLE",
  sessionId = "cvl_01EXAMPLE",
  organisationNumber = "923609016",
  representativeName = "Ola Hansen",
  finding = "They may only sign jointly with others (Styret i fellesskap).",
}: NorwegianVerificationReviewNotificationProps) => (
  <EmailLayout preview={`Manual review: ${representativeName} for ${companyName}`}>
    <EmailHeading>Norwegian verification needs manual review</EmailHeading>
    <Text className="mb-4">
      {representativeName} passed the identity check for {companyName}, but Enhetsregisteret does not confirm that
      they may act for it on their own. The verification is held under review; the company is not verified until
      support decides.
    </Text>
    <InfoSection>
      <Text className="my-1">Finding: {finding}</Text>
      <Text className="my-1">Company: {companyName} ({companyId})</Text>
      <Text className="my-1">Team: {teamId}</Text>
      <Text className="my-1">Organisation number: 0192:{organisationNumber}</Text>
      <Text className="my-1">Verification session: {sessionId}</Text>
    </InfoSection>
    <Text className="mb-4">
      Check who may sign at{" "}
      <a href={`https://data.brreg.no/fullmakt/enheter/${organisationNumber}/signatur`}>signatur</a> and{" "}
      <a href={`https://data.brreg.no/fullmakt/enheter/${organisationNumber}/prokura`}>prokura</a>. Where only a
      combination of people may sign, get the consent of the others first. Then decide the session with{" "}
      <code>support complete-verification {sessionId} --status verified --confirm</code> (or{" "}
      <code>--status rejected</code>).
    </Text>
  </EmailLayout>
);

NorwegianVerificationReviewNotification.PreviewProps = {
  companyName: "Nordlys Handel AS",
  companyId: "c_01EXAMPLE",
  teamId: "team_01EXAMPLE",
  sessionId: "cvl_01EXAMPLE",
  organisationNumber: "923609016",
  representativeName: "Ola Hansen",
  finding: "They may only sign jointly with others (Styret i fellesskap).",
} as NorwegianVerificationReviewNotificationProps;

export default NorwegianVerificationReviewNotification;
