import { Text } from "@react-email/components";
import { EmailLayout, EmailHeading, InfoSection } from "@core/emails/components/shared";

// Sent to support only, so it is not translated.

interface NorwegianVerificationReviewNotificationProps {
  companyName: string;
  companyId: string;
  teamId: string;
  organisationNumber: string;
  representativeName: string;
  finding: string;
}

export const NorwegianVerificationReviewNotification = ({
  companyName = "Nordlys Handel AS",
  companyId = "c_01EXAMPLE",
  teamId = "team_01EXAMPLE",
  organisationNumber = "923609016",
  representativeName = "Kari Nordmann",
  finding = "They may only sign jointly with others (Styret i fellesskap).",
}: NorwegianVerificationReviewNotificationProps) => (
  <EmailLayout preview={`Manual review: ${representativeName} for ${companyName}`}>
    <EmailHeading>Norwegian verification needs manual review</EmailHeading>
    <Text className="mb-4">
      {representativeName} tried to verify {companyName}, but Enhetsregisteret does not confirm that they may
      sign for it on their own. The verification was stopped and the representative was asked to contact support.
    </Text>
    <InfoSection>
      <Text className="my-1">Finding: {finding}</Text>
      <Text className="my-1">Company: {companyName} ({companyId})</Text>
      <Text className="my-1">Team: {teamId}</Text>
      <Text className="my-1">Organisation number: 0192:{organisationNumber}</Text>
    </InfoSection>
    <Text className="mb-4">
      Check who may sign at{" "}
      <a href={`https://data.brreg.no/fullmakt/enheter/${organisationNumber}/signatur`}>signatur</a> and{" "}
      <a href={`https://data.brreg.no/fullmakt/enheter/${organisationNumber}/prokura`}>prokura</a>. Where only a
      combination of people may sign, get the consent of the others before deciding the verification by hand.
    </Text>
  </EmailLayout>
);

NorwegianVerificationReviewNotification.PreviewProps = {
  companyName: "Nordlys Handel AS",
  companyId: "c_01EXAMPLE",
  teamId: "team_01EXAMPLE",
  organisationNumber: "923609016",
  representativeName: "Kari Nordmann",
  finding: "They may only sign jointly with others (Styret i fellesskap).",
} as NorwegianVerificationReviewNotificationProps;

export default NorwegianVerificationReviewNotification;
