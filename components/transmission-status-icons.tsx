import { CloudAlert, Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

interface TransmissionStatusIconsProps {
  sentOverPeppol: boolean;
  sentOverEmail: boolean;
  emailRecipients?: string[];
  /** Reports are filed with a tax administration, not sent over Peppol — suppress the warning. */
  isReporting?: boolean;
}

export function TransmissionStatusIcons({
  sentOverPeppol,
  sentOverEmail,
  emailRecipients,
  isReporting = false,
}: TransmissionStatusIconsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {!sentOverPeppol && !isReporting && (
        <Tooltip>
          <TooltipTrigger asChild>
            <CloudAlert className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t`Not sent over Peppol network`}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {sentOverEmail && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <div>
              <p className="font-medium">{t`Sent via email to:`}</p>
              <ul className="mt-1 space-y-1">
                {emailRecipients?.map((email, index) => (
                  <li key={index} className="text-xs">{email}</li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
