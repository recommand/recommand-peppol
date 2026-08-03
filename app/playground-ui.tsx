import { Info } from "lucide-react";
import { usePlayground } from "@peppol/lib/client/playgrounds";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

export default function PlaygroundUI() {
  const { t } = useTranslation();
  const playground = usePlayground();

  if (!playground?.isPlayground) {
    return null;
  }

  const testNetworkText = playground.useTestNetwork
    ? t`This playground is connected to the Peppol test network.`
    : t`This playground is not connected to the Peppol test network.`;

  return (
    <div className="absolute top-0 left-0 right-0 mx-auto z-50 bg-data dark:text-darkslate w-fit h-fit py-1 px-2 rounded-b-sm">
      <div className="flex items-center justify-center gap-2">
        <p className="text-sm font-medium">
          {playground.useTestNetwork
            ? t`This is a Peppol Test Network playground environment`
            : t`This is a playground environment`}
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-4 h-4 cursor-pointer" />
            </TooltipTrigger>
            <TooltipContent variant="muted" className="max-w-sm">
              <p className="text-sm text-pretty">
                {t`A playground is used to test the Recommand API without affecting production data or communicating over the Peppol network. ${testNetworkText} You can switch to a production environment by clicking the team switcher in the top left.`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
