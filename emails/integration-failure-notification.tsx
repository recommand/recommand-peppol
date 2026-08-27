import { Section, Text } from "@react-email/components";
import { EmailLayout, EmailHeading, InfoSection } from "@core/emails/components/shared";
import { getIntegrationEventDescription } from "@peppol/utils/integrations";
import { fallbackT, type TranslationFunction } from "@core/lib/translations";

interface FailedTask {
  task: string;
  message: string;
  context?: string;
}

interface IntegrationFailureNotificationProps {
  integrationName: string;
  companyName: string;
  event: string;
  failedTasks: FailedTask[];
  t?: TranslationFunction;
}

export const IntegrationFailureNotification = ({
  integrationName,
  companyName,
  event,
  failedTasks,
  t = fallbackT,
}: IntegrationFailureNotificationProps) => {
  const eventDescription = getIntegrationEventDescription(event);
  // Event titles are declared in English and doubles as their translation key.
  const eventName = eventDescription?.title ? t(eventDescription.title) : event;

  return (
    <EmailLayout
      preview={t`Integration ${integrationName} failed for ${companyName}`}
      t={t}
    >
      <EmailHeading>{t`Integration failure`}</EmailHeading>
      <Text className="mb-4">
        {t`The integration ${integrationName} for company ${companyName} failed during ${eventName}.`}
      </Text>
      <InfoSection>
        <Text className="my-1 font-semibold">{t`Failed tasks`}:</Text>
        {failedTasks.map((failedTask, index) => (
          <Section key={index} className="my-2">
            <Text className="my-1 font-semibold">{failedTask.task}</Text>
            <Text className="my-1">{failedTask.message}</Text>
            {failedTask.context && (
              <Text className="my-1 text-sm opacity-75">
                {failedTask.context}
              </Text>
            )}
          </Section>
        ))}
      </InfoSection>
      <Text className="mb-4">
        {t`Please review the integration configuration and ensure all required settings are correct.`}
      </Text>
    </EmailLayout>
  );
};

IntegrationFailureNotification.PreviewProps = {
  integrationName: "Example Integration",
  companyName: "Acme Corporation",
  event: "document.received",
  failedTasks: [
    {
      task: "Process document",
      message: "Failed to process document: Invalid format",
      context: "Document ID: DOC-123",
    },
  ],
} as IntegrationFailureNotificationProps;

export default IntegrationFailureNotification;
