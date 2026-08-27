import { useRef } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Card } from "@core/components/ui/card";
import { ScrollArea } from "@core/components/ui/scroll-area";
import { Paperclip, Trash2 } from "lucide-react";
import { toast } from "@core/components/ui/sonner";
import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";
import { useTranslation } from "@core/hooks/use-translation";

interface AttachmentsEditorProps {
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
}

export function AttachmentsEditor({
  attachments,
  onChange,
}: AttachmentsEditorProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const allowedExtensions = ["csv", "pdf", "png", "jpg", "jpeg", "xlsx", "ods"];

  const handleAddAttachmentFromFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowedExtensions.includes(extension)) {
      toast.error(
        t`Unsupported file type. Allowed types: CSV, PDF, PNG, JPG, XLSX, ODS.`
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;

      // result is a data URL (e.g. "data:application/pdf;base64,....")
      const base64 = result.split(",")[1] || "";

      const newAttachment: Attachment = {
        id: file.name,
        filename: file.name,
        mimeCode: file.type || "application/octet-stream",
        description: null,
        embeddedDocument: base64,
        url: null,
      };

      onChange([...(attachments || []), newAttachment]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFieldChange = (
    index: number,
    field: keyof Attachment,
    value: any
  ) => {
    const next = [...attachments];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  };

  const handleRemove = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t`Optionally attach supporting documents such as PDFs or images. Files are embedded in the Peppol document.`}
        </p>
        <div>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf,.png,.jpg,.jpeg,.xlsx,.ods"
            className="hidden"
            onChange={handleAddAttachmentFromFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="mr-2 h-4 w-4" />
            {t`Upload file`}
          </Button>
        </div>
      </div>

      {(!attachments || attachments.length === 0) && (
        <p className="text-xs text-muted-foreground">
          {t`No attachments added yet.`}
        </p>
      )}

      {attachments && attachments.length > 0 && (
        <ScrollArea className="max-h-80 space-y-3">
          <div className="space-y-3">
            {attachments.map((attachment, index) => (
              <Card key={attachment.id ?? index} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {attachment.filename || t`Attachment ${index + 1}`}
                      </span>
                      {attachment.description && (
                        <span className="text-xs text-muted-foreground">
                          {attachment.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="icon"
                    onClick={() => handleRemove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
