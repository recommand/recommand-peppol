import { useState } from "react";
import { Upload } from "lucide-react";
import { AsyncButton } from "@core/components/async-button";
import { Button } from "@core/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@core/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@core/components/ui/field";
import { Input } from "@core/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { toast } from "@core/components/ui/sonner";
import { useTranslation } from "@core/hooks/use-translation";
import { getDocumentTypeLabel } from "@peppol/lib/client/document-type-labels";
import { type Import, v2Request } from "@peppol/lib/client/intake";
import { useIntakeDocumentTypes } from "@peppol/lib/client/use-intake-document-types";

const DETECT = "detect";

type Props = {
  companies: { id: string; name: string }[];
  defaultCompanyId: string | null;
  onUploaded: (created: Import) => void;
};

/** Upload one PDF or XML file as an import of a company. */
export function UploadImportDialog({ companies, defaultCompanyId, onUploaded }: Props) {
  const { t } = useTranslation();
  // A PDF can be checked against a type AI can extract. XML files are parsed whatever
  // their type, so they need no type.
  const pdfTypes = useIntakeDocumentTypes().filter((documentType) => documentType.aiIntake);
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(defaultCompanyId);
  const [type, setType] = useState<string>(DETECT);
  const [file, setFile] = useState<File | null>(null);
  const selectedCompanyId = companyId ?? defaultCompanyId;

  const upload = async () => {
    if (!selectedCompanyId || !file) {
      toast.error(t`Choose a company and a file`);
      return;
    }
    const body = new FormData();
    const request = { companyId: selectedCompanyId, ...(type === DETECT ? {} : { type }) };
    body.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
    body.append("file", file);
    try {
      const created = await v2Request<Import>("/imports", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      toast.success(t`The file was uploaded and is being processed`);
      setOpen(false);
      setFile(null);
      onUploaded(created);
    } catch (error) {
      toast.error(t`The file could not be uploaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={companies.length === 0} />}>
        <Upload className="h-4 w-4" />
        {t`Upload document`}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t`Upload document`}</DialogTitle>
          <DialogDescription>
            {t`Upload a PDF or XML invoice or credit note. XML and PDFs with embedded XML are read as they are; the content of other PDFs is extracted with AI.`}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {companies.length > 1 && (
            <Field>
              <FieldLabel>{t`Company`}</FieldLabel>
              <Select value={selectedCompanyId ?? undefined} onValueChange={setCompanyId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t`Select a company`} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel>{t`Document type`}</FieldLabel>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DETECT}>{t`Detect automatically`}</SelectItem>
                {pdfTypes.map(({ key }) => (
                  <SelectItem key={key} value={key}>
                    {getDocumentTypeLabel(t, key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t`With a type, a file that contains another type of document fails instead of being processed.`}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="import-file">{t`File`}</FieldLabel>
            <Input
              id="import-file"
              type="file"
              accept=".pdf,.xml,application/pdf,application/xml,text/xml"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <FieldDescription>{t`One PDF or XML file of at most 25 MB.`}</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t`Cancel`}
          </Button>
          <AsyncButton onClick={upload} disabled={!file || !selectedCompanyId}>
            {t`Upload`}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
