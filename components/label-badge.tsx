import { X } from "lucide-react";
import { Badge } from "@core/components/ui/badge";
import { cn } from "@core/lib/utils";

interface LabelBadgeProps {
  name: string;
  colorHex: string;
  onRemove?: () => void;
  className?: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function LabelBadge({ name, colorHex, onRemove, className }: LabelBadgeProps) {
  const textColor = getContrastColor(colorHex);

  return (
    <Badge
      className={cn("rounded-full gap-1.5", className)}
      style={{
        backgroundColor: colorHex,
        color: textColor,
        borderColor: colorHex,
      }}
    >
      <span className="leading-none">{name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "rounded-full p-0.5 transition-colors -mr-1",
            textColor === "#ffffff"
              ? "hover:bg-white/20"
              : "hover:bg-black/10"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
