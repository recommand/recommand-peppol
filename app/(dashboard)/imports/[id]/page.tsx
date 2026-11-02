import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Download, FileText, Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@core/components/confirm-dialog";
import { PageTemplate } from "@core/components/page-template";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { StatusPixel } from "@core/components/ui/status-pixel";
import { toast } from "@core/components/ui/sonner";
import { useHasPermission } from "@core/hooks/user";
import { useTranslation } from "@core/hooks/use-translation";
import { ImportStatusLabel } from "@peppol/components/imports/import-status";
import {
  downloadImportFile,
  failureLabel,
  type Failure,
  type Import,
  type ImportResult,
  isImportFinished,
  type Page,
  v2Request,
} from "@peppol/lib/client/intake";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";

const POLL_MS = 3000;

function FailureDetails({ failure }: { failure: Failure }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="font-medium">{failureLabel(t, failure.code)}</p>
      <p className="text-sm text-muted-foreground">{failure.message}</p>
      {failure.issues && failure.issues.length > 0 && (
        <ul className="list-disc ml-5 text-sm text-muted-foreground">
          {failure.issues.map((issue, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity of their own.
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ImportDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canDelete = useHasPermission(PEPPOL_PERMISSIONS.IMPORTS_WRITE);
  const [importRow, setImportRow] = useState<Import | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [row, page] = await Promise.all([
        v2Request<Import>(`/imports/${id}`),
        v2Request<Page<ImportResult>>(`/imports/${id}/results?limit=100`),
      ]);
      setImportRow(row);
      setResults(page.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const finished = importRow ? isImportFinished(importRow.status) : true;
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [finished, load]);

  const fileName = (fileId: string) => importRow?.files.find((file) => file.id === fileId)?.filename ?? fileId;

  const remove = async () => {
    try {
      await v2Request(`/imports/${id}`, { method: "DELETE" });
      toast.success(t`The import was deleted`);
      navigate("/imports");
    } catch (deleteError) {
      toast.error(t`The import could not be deleted: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
    }
  };

  const download = async (file: Import["files"][number]) => {
    try {
      await downloadImportFile(file);
    } catch (downloadError) {
      toast.error(t`The file could not be downloaded: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
    }
  };

  if (!importRow) {
    return (
      <PageTemplate breadcrumbs={[{ label: "Peppol" }, { label: t`Imports`, href: "/imports" }, { label: id ?? "" }]}>
        <div className="flex items-center justify-center py-8">
          {error ? <p className="text-muted-foreground">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        </div>
      </PageTemplate>
    );
  }

  const source = importRow.source;
  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Imports`, href: "/imports" }, { label: importRow.id }]}
      buttons={
        canDelete && finished
          ? [
              <ConfirmDialog
                key="delete"
                title={t`Delete import`}
                description={t`The import and its results are removed. The documents it produced stay.`}
                confirmButtonText={t`Delete`}
                onConfirm={remove}
                trigger={
                  <Button variant="outline">
                    <Trash2 className="h-4 w-4" />
                    {t`Delete`}
                  </Button>
                }
              />,
            ]
          : []
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t`Results`}</CardTitle>
            <CardDescription>
              {finished
                ? t`Each result is one document, or the reason why no document was made.`
                : t`The files are being processed. Results appear here as they are ready.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {importRow.error && (
              <div className="flex gap-3 rounded-lg border p-3">
                <StatusPixel tone="attention" className="mt-1.5" />
                <FailureDetails failure={importRow.error} />
              </div>
            )}
            {results.length === 0 && !importRow.error && (
              <p className="text-sm text-muted-foreground">
                {finished ? t`No business document was found in the files.` : t`No results yet.`}
              </p>
            )}
            {results.map((result) => (
              <div key={result.id} className="flex gap-3 rounded-lg border p-3">
                <StatusPixel tone={result.documentId ? "positive" : "attention"} className="mt-1.5" />
                <div className="flex-1 space-y-2">
                  {result.documentId ? (
                    <Link to={`/transmitted-documents/${result.documentId}`} className="font-medium hover:underline">
                      {t`View document`}
                    </Link>
                  ) : (
                    result.error && <FailureDetails failure={result.error} />
                  )}
                  <div className="flex flex-wrap gap-1">
                    {result.locations.map((location) => (
                      <Badge key={location.fileId} variant="outline">
                        <FileText />
                        {fileName(location.fileId)}
                        {location.role === "supporting" && ` (${t`supporting`})`}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t`Import`}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t`Status`}</span>
                <ImportStatusLabel status={importRow.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t`Received`}</span>
                <span>{new Date(importRow.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t`Source`}</span>
                <span>{source.channel === "email" ? t`Email` : t`Upload`}</span>
              </div>
              {source.channel === "email" && (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{t`From`}</span>
                    <span className="truncate">{source.from ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{t`To`}</span>
                    <span className="truncate">{source.to}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{t`Subject`}</span>
                    <span className="truncate">{source.subject ?? "—"}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t`Documents`}</span>
                <span>{importRow.resultCounts.documents}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t`Failed`}</span>
                <span>{importRow.resultCounts.failed}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t`Files`}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {importRow.files.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{file.filename}</span>
                  <Button variant="ghost" size="icon" title={t`Download`} onClick={() => download(file)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTemplate>
  );
}
