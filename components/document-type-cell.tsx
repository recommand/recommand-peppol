import { useState } from "react";
import { CircleX } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@core/components/ui/popover";
import type { ValidationResponse } from "@peppol/types/validation";
import { ValidationDetails } from "./validation-details";
import { useTranslation } from "@core/hooks/use-translation";
import { getDocumentTypeLabel } from "@peppol/lib/client/document-type-labels";

interface DocumentTypeCellProps {
  type: string;
  validation?: ValidationResponse | null;
}

export function DocumentTypeCell({ type, validation }: DocumentTypeCellProps) {
  const { t } = useTranslation();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const hasValidationWarning = validation && validation.result !== "valid";

  return (
    <div className="flex items-center gap-2">
      <span>{getDocumentTypeLabel(t, type)}</span>
      {hasValidationWarning && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center justify-center"
              onMouseEnter={() => setIsPopoverOpen(true)}
              onMouseLeave={() => setIsPopoverOpen(false)}
            >
              <CircleX className="h-4 w-4 text-destructive" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="start"
            onMouseEnter={() => setIsPopoverOpen(true)}
            onMouseLeave={() => setIsPopoverOpen(false)}
          >
            <div className="p-3">
              <div className="text-sm font-medium">{t`Document Validation Issues`}</div>
              <ValidationDetails validation={validation} />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
