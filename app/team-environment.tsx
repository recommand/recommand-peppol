import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { Team } from "@core/data/teams";
import { StatusPixel } from "@core/components/ui/status-pixel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";
import {
  getPlayground,
  usePlayground,
  type PlaygroundType,
} from "@peppol/lib/client/playgrounds";

type Place = "sidebar" | "panel";

/**
 * The environment marker under a team's name in the team switcher: an
 * outlined mint pixel for a playground, a filled one for production.
 */
export function teamEnvironmentMeta(team: Team & { isMember?: boolean }, place: Place) {
  // Teams the user is not a member of are only listed for support; looking
  // each one up would cost a request per team.
  if (team.isMember === false) {
    return null;
  }
  return <TeamEnvironment teamId={team.id} place={place} />;
}

function TeamEnvironment({ teamId, place }: { teamId: string; place: Place }) {
  const { t } = useTranslation();
  const [playground, setPlayground] = useState<PlaygroundType | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setPlayground(undefined);
    getPlayground(teamId).then((result) => {
      if (current) setPlayground(result);
    });
    return () => {
      current = false;
    };
  }, [teamId]);

  if (playground === undefined) {
    return null;
  }

  const label = !playground?.isPlayground
    ? t`Production`
    : playground.useTestNetwork
      ? t`Playground · Test network`
      : t`Playground`;

  if (place === "panel") {
    return <span className="text-xs text-muted-foreground">{label}</span>;
  }

  return (
    <span className="flex items-center gap-1.5 text-table-head text-sidebar-muted-foreground [text-transform:var(--table-head-transform)]">
      <StatusPixel size="xs" tone="positive" shape={playground?.isPlayground ? "outline" : "filled"} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * A notice at the bottom of the sidebar while the active team is a
 * playground, with an explanation in its tooltip.
 */
export function PlaygroundBanner() {
  const { t } = useTranslation();
  const playground = usePlayground();

  if (!playground?.isPlayground) {
    return null;
  }

  const testNetworkText = playground.useTestNetwork
    ? t`This playground is connected to the Peppol test network.`
    : t`This playground is not connected to the Peppol test network.`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex w-full cursor-default items-center gap-2.5 rounded-lg bg-sidebar-accent px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-control group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
            />
          }
        >
          <StatusPixel size="xs" tone="positive" shape="outline" />
          <span className="grid min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm text-sidebar-accent-foreground">{t`Playground`}</span>
            <span className="truncate text-xs text-sidebar-muted-foreground">
              {playground.useTestNetwork ? t`On the Peppol test network` : t`Not on the Peppol network`}
            </span>
          </span>
          <Info className="size-4 shrink-0 text-sidebar-muted-foreground group-data-[collapsible=icon]:hidden" />
        </TooltipTrigger>
        <TooltipContent side="right" align="end">
          <p className="text-pretty">
            {t`A playground is used to test the Recommand API without affecting production data or communicating over the Peppol network. ${testNetworkText} You can switch to a production environment by clicking the team switcher in the top left.`}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
