import type { ComponentProps } from "react";
import { StatusLabel } from "@core/components/ui/status-pixel";
import { useTranslation } from "@core/hooks/use-translation";
import { type ImportStatus, importStatusLabel } from "@peppol/lib/client/intake";

type Pixel = Pick<ComponentProps<typeof StatusLabel>, "shape" | "tone">;

const pixels: Record<ImportStatus, Pixel> = {
  queued: { shape: "outline", tone: "normal" },
  processing: { shape: "half", tone: "normal" },
  completed: { shape: "filled", tone: "positive" },
  partially_completed: { shape: "filled", tone: "attention" },
  failed: { shape: "filled", tone: "attention" },
  ignored: { shape: "unknown" },
};

export function ImportStatusLabel({ status }: { status: ImportStatus }) {
  const { t } = useTranslation();
  return <StatusLabel {...pixels[status]}>{importStatusLabel(t, status)}</StatusLabel>;
}
