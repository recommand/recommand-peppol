import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@core/components/ui/popover";
import type { ValidationResponse } from "@peppol/types/validation";
import { ValidationDetails, ValidationStatusIcon } from "./validation-details";
import { useTranslation } from "@core/hooks/use-translation";
import { getDocumentTypeLabel } from "@peppol/lib/client/document-type-labels";
import { getValidationStatus } from "@peppol/lib/client/validation-status";

interface DocumentTypeCellProps {
  type: string;
  validation?: ValidationResponse | null;
}

export function DocumentTypeCell({ type, validation }: DocumentTypeCellProps) {
  const { t } = useTranslation();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const status = getValidationStatus(t, validation);
  // A document no rule set exists for was not checked, which is nothing to flag in a list.
  const showsStatus = status && status.kind !== "notValidated";

  return (
    <div className="flex items-center gap-2">
      <span>{getDocumentTypeLabel(t, type)}</span>
      {showsStatus && validation && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center justify-center"
              onMouseEnter={() => setIsPopoverOpen(true)}
              onMouseLeave={() => setIsPopoverOpen(false)}
            >
              <ValidationStatusIcon validation={validation} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="start"
            onMouseEnter={() => setIsPopoverOpen(true)}
            onMouseLeave={() => setIsPopoverOpen(false)}
          >
            <div className="p-3">
              {status.kind === "invalid" ? (
                <>
                  <div className="text-sm font-medium">{t`Document Validation Issues`}</div>
                  <ValidationDetails validation={validation} />
                </>
              ) : (
                <>
                  <div className="text-sm font-medium">{status.label}</div>
                  <div className="text-xs text-muted-foreground">{status.description}</div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
