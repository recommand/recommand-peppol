import { useRef, useState } from "react";
import { Card } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Label } from "@core/components/ui/label";
import { toast } from "@core/components/ui/sonner";
import { cn } from "@core/lib/utils";
import { Upload } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

interface XmlUploadZoneProps {
  loadedFileName: string | null;
  onLoaded: (document: string, fileName: string) => void;
  onClear: () => void;
  label?: string;
  maxBytes?: number;
}

export function XmlUploadZone({
  loadedFileName,
  onLoaded,
  onClear,
  label,
  maxBytes = 5 * 1024 * 1024,
}: XmlUploadZoneProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t`Upload XML file`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const loadFile = async (file: File) => {
    if (file.size > maxBytes) {
      toast.error(t`XML file is too large (max 5MB)`);
      return;
    }

    if (
      !file.name.toLowerCase().endsWith(".xml") &&
      !file.type.toLowerCase().includes("xml")
    ) {
      toast.error(t`Please upload an XML file`);
      return;
    }

    const text = await file.text();
    onLoaded(text, file.name);
  };

  return (
    <div>
      <Label>{resolvedLabel}</Label>
      <Card
        className={cn(
          "mt-2 p-4 border-dashed",
          isDragging ? "border-primary bg-muted/70" : "bg-muted/30"
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (!file) return;
          try {
            await loadFile(file);
          } catch {
            toast.error(t`Failed to read file`);
          }
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Upload className="h-5 w-5 mt-0.5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t`Drag & drop an XML file`}</p>
              <p className="text-xs text-muted-foreground">
                {t`Or choose a file to fill the XML textarea below`}
              </p>
              {loadedFileName && (
                <p className="text-xs text-accent">{t`Loaded: ${loadedFileName}`}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  await loadFile(file);
                } catch {
                  toast.error(t`Failed to read file`);
                } finally {
                  e.target.value = "";
                }
              }}
            />
            <Button
              type="button"
              variant="default"
              onClick={() => fileInputRef.current?.click()}
            >
              {t`Choose file`}
            </Button>
            <Button type="button" variant="outline" onClick={onClear}>
              {t`Clear`}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
