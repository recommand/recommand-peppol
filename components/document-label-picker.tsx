import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@core/components/ui/popover";
import type { Label } from "@peppol/types/label";

interface DocumentLabelPickerProps {
  labels: Label[];
  assignedLabels: Array<Pick<Label, "id">>;
  trigger: ReactNode;
  onAssign: (label: Label) => Promise<void> | void;
  onUnassign?: (label: Label) => Promise<void> | void;
  showAssignedLabels?: boolean;
  title?: string;
  emptyText?: string;
  align?: "start" | "center" | "end";
}

export function DocumentLabelPicker({
  labels,
  assignedLabels,
  trigger,
  onAssign,
  onUnassign,
  showAssignedLabels = false,
  title = "Assign labels",
  emptyText = "No available labels",
  align = "start",
}: DocumentLabelPickerProps) {
  const [updatingLabelId, setUpdatingLabelId] = useState<string | null>(null);
  const assignedLabelIds = new Set(assignedLabels.map((label) => label.id));
  const visibleLabels = showAssignedLabels
    ? labels
    : labels.filter((label) => !assignedLabelIds.has(label.id));

  const handleSelect = async (label: Label) => {
    const isAssigned = assignedLabelIds.has(label.id);

    if (updatingLabelId || (isAssigned && !onUnassign)) return;

    setUpdatingLabelId(label.id);

    try {
      if (isAssigned) {
        await onUnassign?.(label);
      } else {
        await onAssign(label);
      }
    } finally {
      setUpdatingLabelId(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align={align}>
        <div className="p-2">
          <div className="mb-2 text-sm font-medium">{title}</div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {visibleLabels.map((label) => {
              const isAssigned = assignedLabelIds.has(label.id);
              const isUpdating = updatingLabelId === label.id;

              return (
                <button
                  key={label.id}
                  type="button"
                  disabled={updatingLabelId !== null}
                  onClick={() => handleSelect(label)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.colorHex }}
                  />
                  <span className="flex-1">{label.name}</span>
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    isAssigned && <Check className="h-4 w-4" />
                  )}
                </button>
              );
            })}
            {visibleLabels.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {emptyText}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
