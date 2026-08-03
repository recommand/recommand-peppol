import { CheckCircle2, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

interface VerificationStatusIconProps {
  isVerified: boolean;
}

export function VerificationStatusIcon({ isVerified }: VerificationStatusIconProps) {
  const { t } = useTranslation();
  if (isVerified) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <CheckCircle2 className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>
          <p>{t`Company is verified`}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <XCircle className="h-4 w-4 text-destructive" />
      </TooltipTrigger>
      <TooltipContent>
        <p>{t`Company is not verified`}</p>
      </TooltipContent>
    </Tooltip>
  );
}
