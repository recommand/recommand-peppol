import { useState } from "react";
import { Label } from "@core/components/ui/label";
import { Input } from "@core/components/ui/input";
import { Card } from "@core/components/ui/card";
import { FileText } from "lucide-react";
import { XmlUploadZone } from "./xml-upload-zone";
import { CodeTextarea } from "./code-textarea";
import { useTranslation } from "@core/hooks/use-translation";

interface XmlFormProps {
  document: string;
  onChange: (document: string) => void;
  doctypeId?: string;
  onDoctypeIdChange: (id: string) => void;
  processId?: string;
  onProcessIdChange: (id: string) => void;
}

export function XmlForm({
  document,
  onChange,
  doctypeId,
  onDoctypeIdChange,
  processId,
  onProcessIdChange,
}: XmlFormProps) {
  const { t } = useTranslation();
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/50">
        <div className="flex items-start gap-2">
          <FileText className="h-5 w-5 mt-0.5 text-muted-foreground" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">{t`Raw XML Document`}</p>
            <p className="text-xs text-muted-foreground">
              {t`Upload or paste your UBL-formatted XML document here. The document should be compliant with the Peppol BIS 3.0 standard.`}
            </p>
          </div>
        </div>
      </Card>

      <div>
        <Label htmlFor="doctypeId">{t`Document Type ID (optional)`}</Label>
        <Input
          id="doctypeId"
          value={doctypeId || ""}
          onChange={(e) => onDoctypeIdChange(e.target.value)}
          placeholder=""
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t`Leave blank to auto-detect from your XML (if possible)`}
        </p>
      </div>

      <div>
        <Label htmlFor="processId">{t`Process ID (optional)`}</Label>
        <Input
          id="processId"
          value={processId || ""}
          onChange={(e) => onProcessIdChange(e.target.value)}
          placeholder=""
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t`Leave blank to auto-detect from the document type`}
        </p>
      </div>

      <XmlUploadZone
        loadedFileName={uploadedFileName}
        onLoaded={(xml, fileName) => {
          setUploadedFileName(fileName);
          onChange(xml);
        }}
        onClear={() => {
          setUploadedFileName(null);
          onChange("");
        }}
      />

      <div>
        <Label htmlFor="xmlDocument">{t`XML Document *`}</Label>
        <div className="mt-2">
          <CodeTextarea
            id="xmlDocument"
            value={document}
            onChange={onChange}
            language="xml"
            required
            placeholder=""
          />
        </div>
      </div>
    </div>
  );
}
