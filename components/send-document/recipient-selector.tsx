import { Input } from "@core/components/ui/input";
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

interface RecipientSelectorProps {
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}

export function RecipientSelector({
  value,
  onChange,
  optional = false,
}: RecipientSelectorProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={inputValue}
          onChange={handleInputChange}
          placeholder="0208:1234567894"
          required={!optional}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <Info className="h-4 w-4 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              {t`Enter the recipient's Peppol ID. Format: [scheme]:[identifier]`}
            </p>
            <p className="text-sm mt-2">
              {t`E.g. 0208:[Belgian Enterprise Number]`}
            </p>
            <p className="text-sm mt-2">
              {t`Leave empty to send via email only.`}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
