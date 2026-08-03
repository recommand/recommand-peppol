import { useActiveTeam } from "@core/hooks/user";
import { PlansGrid } from "../plans-grid";
import PlaygroundOption from "./playground-option";
import { CreateTeamButton } from "@core/components/create-team-button";
import { useTranslation } from "@core/hooks/use-translation";

export default function SubscriptionOnboarding({ onComplete }: { onComplete: () => Promise<void> }) {
  const { t } = useTranslation();
  const team = useActiveTeam();

  if (!team) {
    return <div className="text-center space-y-4">
      <p>{t`You must be in a team to complete this step`}</p>
      <CreateTeamButton />
    </div>;
  }

  return <div className="w-[min(56rem,calc(100vw-2rem))]">
    <PlansGrid
      currentSubscription={null}
      teamId={team.id}
      onSubscriptionUpdate={onComplete}
      showHeader={false}
    />
    <PlaygroundOption
      buttonText={t`Skip Subscription - Create Playground`}
      description={t`Skip subscription setup by creating a playground to test your Peppol API integrations without billing requirements, or switch to another team.`}
    />
  </div>;
}
