import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

interface PartyInfo {
  name: string;
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  postalZone?: string | null;
  country?: string | null;
  vatNumber?: string | null;
}

interface PartyInfoTooltipProps {
  partyInfo: PartyInfo;
  peppolAddress: string;
}

export function PartyInfoTooltip({ partyInfo, peppolAddress }: PartyInfoTooltipProps) {
  const { t } = useTranslation();
  const addressParts = [
    partyInfo.street,
    partyInfo.street2,
    partyInfo.city,
    partyInfo.postalZone,
    partyInfo.country
  ].filter(Boolean);
  
  const fullAddress = addressParts.join(", ");

  if (!fullAddress) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-4 w-4 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        <div>
          <p className="font-medium">{partyInfo.name}</p>
          <p className="text-xs mt-1">{fullAddress}</p>
          {partyInfo.vatNumber && (
            <p className="text-xs mt-1">{t`VAT: ${partyInfo.vatNumber}`}</p>
          )}
          <p className="text-xs mt-1">{t`Peppol address: ${peppolAddress}`}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
