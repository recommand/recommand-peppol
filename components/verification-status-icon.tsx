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
        <TooltipTrigger render={<CheckCircle2 className="h-4 w-4" />} />
        <TooltipContent>
          <p>{t`Company is verified`}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<XCircle className="h-4 w-4 text-destructive" />} />
      <TooltipContent>
        <p>{t`Company is not verified`}</p>
      </TooltipContent>
    </Tooltip>
  );
}
