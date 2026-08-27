import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import type { TransmittedDocuments } from "@peppol/api/documents";
import type { Labels } from "@peppol/api/labels";
import { useActiveTeam } from "@core/hooks/user";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "@core/components/ui/sonner";
import { stringifyActionFailure } from "@recommand/lib/utils";
import {
  Loader2,
  Trash2,
  FolderArchive,
  ArrowDown,
  ArrowUp,
  Copy,
  ChevronDown,
  ExternalLink,
  Tag,
  CheckCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { AsyncButton } from "@core/components/async-button";
import { TransmissionStatusIcons } from "@peppol/components/transmission-status-icons";
import type {
  TransmittedDocument,
  TransmittedDocumentWithoutBody,
} from "@peppol/data/transmitted-documents";
import type { Label } from "@peppol/types/label";
import { Badge } from "@core/components/ui/badge";
import { LabelBadge } from "@peppol/components/label-badge";
import { Alert, AlertDescription, AlertTitle } from "@core/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@core/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@core/components/ui/collapsible";
import { SyntaxHighlighter } from "@peppol/components/send-document/syntax-highlighter";
import { ValidationDetails } from "@peppol/components/validation-details";
import type { ValidationResponse } from "@peppol/types/validation";
import { CsvAttachmentTable } from "@peppol/components/csv-attachment-table";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import { DocumentLabelPicker } from "@peppol/components/document-label-picker";
import { isReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/keys";
import { useTranslation } from "@core/hooks/use-translation";
import { getDocumentTypeLabel } from "@peppol/lib/client/document-type-labels";

const client = rc<TransmittedDocuments>("peppol");
const labelsClient = rc<Labels>("v1");

type TransmittedDocumentWithLabels = TransmittedDocument & {
  labels?: Label[];
};

export default function TransmittedDocumentDetailPage() {
  const { t, language } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeTeam = useActiveTeam();

  const [doc, setDoc] = useState<TransmittedDocumentWithLabels | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [relatedDocuments, setRelatedDocuments] = useState<
    TransmittedDocumentWithoutBody[]
  >([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    const fetchDocument = async () => {
      if (!id || !activeTeam?.id) return;

      try {
        setIsLoading(true);
        const response = await client[":teamId"]["documents"][
          ":documentId"
        ].$get({
          param: {
            teamId: activeTeam.id,
            documentId: id,
          },
        });
        const json = await response.json() as any;

        if (!json.success) {
          toast.error(stringifyActionFailure(json.errors));
          navigate("/transmitted-documents");
          return;
        }
        const apiDoc = json.document as TransmittedDocumentWithLabels & {
          createdAt: string;
          updatedAt: string;
          readAt: string | null;
        };

        const hydratedDoc: TransmittedDocumentWithLabels = {
          ...apiDoc,
          createdAt: new Date(apiDoc.createdAt),
          updatedAt: new Date(apiDoc.updatedAt),
          readAt: apiDoc.readAt ? new Date(apiDoc.readAt) : null,
        };

        setDoc(hydratedDoc);
      } catch (error) {
        console.error("Error fetching document:", error);
        toast.error(t`Failed to load document`);
        navigate("/transmitted-documents");
      } finally {
        setIsLoading(false);
      }
    };

    fetchDocument();
  }, [id, activeTeam?.id, navigate]);

  useEffect(() => {
    const fetchLabels = async () => {
      if (!activeTeam?.id) {
        setLabels([]);
        return;
      }

      try {
        const response = await labelsClient[":teamId"]["labels"].$get({
          param: { teamId: activeTeam.id },
        });
        const json = await response.json();

        if (!json.success || !Array.isArray(json.labels)) {
          throw new Error(t`Failed to load labels`);
        }

        setLabels(json.labels);
      } catch (error) {
        console.error("Failed to load labels:", error);
        toast.error(t`Failed to load labels`);
        setLabels([]);
      }
    };

    fetchLabels();
  }, [activeTeam?.id]);

  useEffect(() => {
    if (!activeTeam?.id || !doc) {
      setPreviewHtml(null);
      setIsPreviewLoading(false);
      return;
    }

    const fetchPreview = async () => {
      try {
        setIsPreviewLoading(true);
        const previewResponse = await client[":teamId"]["documents"][
          ":documentId"
        ]["render"][":type"].$get({
          param: {
            teamId: activeTeam.id,
            documentId: doc.id,
            type: "html",
          },
        });
        if (previewResponse.ok) {
          const html = await previewResponse.text();
          setPreviewHtml(html);
        }
      } catch (error) {
        console.error("Failed to load rendered document HTML:", error);
        setPreviewHtml(null);
      } finally {
        setIsPreviewLoading(false);
      }
    };

    fetchPreview();
  }, [activeTeam?.id, doc]);

  useEffect(() => {
    const fetchRelatedDocuments = async () => {
      if (!activeTeam?.id || doc?.type !== "messageLevelResponse") {
        setRelatedDocuments([]);
        return;
      }

      try {
        setIsLoadingRelated(true);
        const response = await client[":teamId"]["documents"].$get({
          param: { teamId: activeTeam.id },
          query: {
            envelopeId: (doc.parsed as MessageLevelResponse).envelopeId,
          },
        });
        const json = await response.json();

        if (json.success) {
          const docs = (json.documents || [])
            .filter((d: any) => d.id !== doc.id)
            .map((d: any) => ({
              ...d,
              createdAt: new Date(d.createdAt),
              updatedAt: new Date(d.updatedAt),
              readAt: d.readAt ? new Date(d.readAt) : null,
            })) as TransmittedDocumentWithoutBody[];
          setRelatedDocuments(docs);
        }
      } catch (error) {
        console.error("Failed to fetch related documents:", error);
        setRelatedDocuments([]);
      } finally {
        setIsLoadingRelated(false);
      }
    };

    fetchRelatedDocuments();
  }, [activeTeam?.id, doc?.id, doc?.envelopeId]);

  const handleDelete = async () => {
    if (!activeTeam?.id || !doc) return;
    if (!confirm(t`Are you sure you want to delete this document?`)) return;

    try {
      const response = await client[":teamId"]["documents"][
        ":documentId"
      ].$delete({
        param: {
          teamId: activeTeam.id,
          documentId: doc.id,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`Document deleted successfully`);
      navigate("/transmitted-documents");
    } catch (error) {
      console.error("Failed to delete document:", error);
      toast.error(t`Failed to delete document`);
    }
  };

  const handleUpdateLabel = async (label: Label, isAssigned: boolean) => {
    if (!activeTeam?.id || !doc) return;

    const previousLabels = doc.labels || [];

    setDoc({
      ...doc,
      labels: isAssigned
        ? previousLabels.filter(
            (assignedLabel) => assignedLabel.id !== label.id
          )
        : [...previousLabels, label],
    });

    try {
      const labelRoute =
        client[":teamId"]["documents"][":documentId"]["labels"][":labelId"];
      const params = {
        param: {
          teamId: activeTeam.id,
          documentId: doc.id,
          labelId: label.id,
        },
      };
      const response = isAssigned
        ? await labelRoute.$delete(params)
        : await labelRoute.$post(params);
      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
    } catch (error) {
      console.error("Failed to update document label:", error);
      setDoc((currentDoc) =>
        currentDoc ? { ...currentDoc, labels: previousLabels } : currentDoc
      );
      toast.error(
        isAssigned ? t`Failed to remove label` : t`Failed to assign label`
      );
    }
  };

  const handleToggleMarkAsRead = async () => {
    if (!activeTeam?.id || !doc) return;

    const previousReadAt = doc.readAt;
    const read = previousReadAt === null;

    setDoc({
      ...doc,
      readAt: read ? new Date() : null,
    });

    try {
      const response = await client[":teamId"]["documents"][":documentId"][
        "markAsRead"
      ].$post({
        param: {
          teamId: activeTeam.id,
          documentId: doc.id,
        },
        json: { read },
      });
      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(
        read ? t`Document marked as read` : t`Document marked as unread`
      );
    } catch (error) {
      console.error("Failed to update document read status:", error);
      setDoc((currentDoc) =>
        currentDoc ? { ...currentDoc, readAt: previousReadAt } : currentDoc
      );
      toast.error(t`Failed to update document read status`);
    }
  };

  const handleDownload = async () => {
    if (!activeTeam?.id || !doc) return;

    try {
      const response = await client[":teamId"]["documents"][":documentId"][
        "downloadPackage"
      ].$get({
        param: {
          teamId: activeTeam.id,
          documentId: doc.id,
        },
        query: {
          generatePdf: "always",
        },
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${doc.id}.zip`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t`Document downloaded successfully`);
    } catch (error) {
      console.error("Failed to download document:", error);
      toast.error(t`Failed to download document`);
    }
  };

  if (isLoading) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: "Peppol", href: "/" },
          {
            label: t`Sent and received documents`,
            href: "/transmitted-documents",
          },
          { label: t`Loading...` },
        ]}
        description={t`Loading document details...`}
      >
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageTemplate>
    );
  }

  if (!doc) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: "Peppol", href: "/" },
          {
            label: t`Sent and received documents`,
            href: "/transmitted-documents",
          },
          { label: t`Not found` },
        ]}
        description={t`Document not found`}
      >
        <div className="flex items-center justify-center h-96">
          <Button onClick={() => navigate("/transmitted-documents")}>
            {t`Back to documents`}
          </Button>
        </div>
      </PageTemplate>
    );
  }

  const parsed: any = doc.parsed;
  const attachments: any[] = Array.isArray(parsed?.attachments)
    ? parsed.attachments
    : [];

  const directionIcon =
    doc.direction === "incoming" ? (
      <ArrowDown className="h-4 w-4" />
    ) : (
      <ArrowUp className="h-4 w-4" />
    );

  const documentNumber =
    parsed?.invoiceNumber ??
    parsed?.creditNoteNumber ??
    parsed?.selfBillingInvoiceNumber ??
    parsed?.selfBillingCreditNoteNumber;
  const hasStructuredData = !!parsed && doc.type !== "unknown";
  const hasXml = Boolean(doc.xml);
  const titleNumber =
    documentNumber || `${doc.id.slice(0, 6)}...${doc.id.slice(-6)}`;
  const directionLabel =
    doc.direction === "incoming" ? t`Incoming document` : t`Outgoing document`;

  const pageTitle =
    doc.validation && doc.validation.result !== "valid" ? (
      <div className="flex items-center gap-2">
        <span>{doc.id}</span>
        <Badge variant="destructive" className="capitalize text-sm">
          {doc.validation.result.replaceAll("_", " ")}
        </Badge>
      </div>
    ) : undefined;

  return (
    <PageTemplate
      breadcrumbs={[
        { label: "Peppol", href: "/" },
        {
          label: t`Sent and received documents`,
          href: "/transmitted-documents",
        },
        { label: doc.id },
      ]}
      title={pageTitle}
      description={t`Preview and metadata for this transmitted Peppol document.`}
      buttons={[
        <DocumentLabelPicker
          key="labels"
          labels={labels}
          assignedLabels={doc.labels || []}
          onAssign={(label) => handleUpdateLabel(label, false)}
          onUnassign={(label) => handleUpdateLabel(label, true)}
          showAssignedLabels
          title={t`Document labels`}
          emptyText={t`No labels available`}
          align="end"
          trigger={
            <Button variant="outline">
              <Tag className="h-4 w-4" />
            </Button>
          }
        />,
        <AsyncButton
          key="read-status"
          variant="outline"
          size="icon"
          onClick={handleToggleMarkAsRead}
          title={doc.readAt ? t`Mark as unread` : t`Mark as read`}
        >
          <CheckCheck
            className={doc.readAt ? "h-4 w-4 opacity-30" : "h-4 w-4"}
          />
        </AsyncButton>,
        <AsyncButton key="download" variant="outline" onClick={handleDownload}>
          <FolderArchive className="h-4 w-4 mr-2" />
          {t`Download package`}
        </AsyncButton>,
        <AsyncButton key="delete" variant="destructive" onClick={handleDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          {t`Delete`}
        </AsyncButton>,
      ]}
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              {directionIcon}
              <span>{directionLabel}</span>
              <span>•</span>
              <span>{getDocumentTypeLabel(t, doc.type)}</span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {titleNumber}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
              <span className="text-muted-foreground">
                {t`Created ${new Date(doc.createdAt).toLocaleString(language, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                })}`}
              </span>
              {doc.readAt && (
                <>
                  <span>•</span>
                  <span className="text-muted-foreground">
                    {t`Read ${new Date(doc.readAt).toLocaleString(language, {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })}`}
                  </span>
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <TransmissionStatusIcons
                sentOverPeppol={doc.sentOverPeppol}
                sentOverEmail={doc.sentOverEmail}
                emailRecipients={doc.emailRecipients || undefined}
                isReporting={isReportingDocumentTypeKey(doc.type)}
              />
              {doc.labels &&
                doc.labels.map((label) => (
                  <LabelBadge
                    key={label.id}
                    name={label.name}
                    colorHex={label.colorHex}
                  />
                ))}
            </div>
          </CardContent>
        </Card>

        {!hasStructuredData && (
          <Alert className="border-dashed">
            <AlertTitle>{t`Limited document details`}</AlertTitle>
            <AlertDescription>
              {hasXml
                ? t`This document could not be fully parsed. Only technical metadata and raw XML are available.`
                : t`This document could not be fully parsed. Only technical metadata is available.`}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{t`Document preview`}</CardTitle>
              <CardDescription>
                {t`Preview of the billing document and any attachments.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="main" className="w-full">
                {attachments.length > 0 && (
                  <TabsList className="flex w-full gap-2 overflow-x-auto mb-3">
                    <TabsTrigger value="main">
                      {t`Generated document preview`}
                    </TabsTrigger>
                    {attachments.map((attachment, index) => (
                      <TabsTrigger
                        key={attachment.id ?? `${attachment.filename}-${index}`}
                        value={`attachment-${index}`}
                      >
                        {(() => {
                          const label = attachment.filename || attachment.description || (attachment.url ? t`External link` : t`Attachment ${index + 1}`);
                          return label.length > 24 ? `${label.slice(0, 24)}…` : label;
                        })()}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}

                <TabsContent value="main">
                  {isPreviewLoading && (
                    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t`Loading preview...`}
                    </div>
                  )}
                  {!isPreviewLoading && previewHtml && (
                    <div className="border rounded-md overflow-hidden bg-background">
                      <iframe
                        title={t`Document preview`}
                        srcDoc={previewHtml}
                        className="w-full h-[800px] border-0"
                      />
                    </div>
                  )}
                  {!isPreviewLoading && !previewHtml && (
                    <p className="text-sm text-muted-foreground">
                      {t`No preview available for this document.`}
                    </p>
                  )}
                </TabsContent>

                {attachments.map((attachment, index) => {
                  const tabValue = `attachment-${index}`;
                  const hasEmbedded = !!attachment.embeddedDocument;
                  const mimeType =
                    (typeof attachment.mimeCode === "string" &&
                      attachment.mimeCode) ||
                    "application/octet-stream";
                  const dataUrl =
                    hasEmbedded && attachment.embeddedDocument
                      ? `data:${mimeType};base64,${attachment.embeddedDocument}`
                      : null;

                  const isImage = mimeType.startsWith("image/");
                  const isPdf = mimeType === "application/pdf";
                  const isTextLike = mimeType.startsWith("text/");
                  const isCsv =
                    mimeType === "text/csv" ||
                    (typeof attachment.filename === "string" &&
                      attachment.filename.toLowerCase().endsWith(".csv"));

                  let decodedText: string | null = null;
                  if (
                    hasEmbedded &&
                    isTextLike &&
                    typeof window !== "undefined"
                  ) {
                    try {
                      decodedText = window.atob(attachment.embeddedDocument);
                    } catch {
                      decodedText = null;
                    }
                  }

                  const isUrlOnly = !hasEmbedded && !!attachment.url;
                  const attachmentTitle =
                    attachment.description ||
                    attachment.filename ||
                    (attachment.url
                      ? (() => {
                          try {
                            return new URL(attachment.url).hostname;
                          } catch {
                            return attachment.url;
                          }
                        })()
                      : null) ||
                    t`Attachment`;
                  const showMimeType = hasEmbedded || (!isUrlOnly && mimeType !== "application/octet-stream");

                  return (
                    <TabsContent key={tabValue} value={tabValue}>
                      <div className="space-y-3">
                        <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                          <span className="font-mono break-all">
                            {attachmentTitle}
                          </span>
                          {showMimeType && (
                            <>
                              <span>•</span>
                              <span>{mimeType}</span>
                            </>
                          )}
                        </div>

                        {hasEmbedded && isImage && dataUrl && (
                          <div className="flex justify-center">
                            <img
                              src={dataUrl}
                              alt={attachment.filename || t`Image attachment`}
                              className="max-h-[800px] w-auto rounded border bg-background"
                            />
                          </div>
                        )}

                        {hasEmbedded && isPdf && dataUrl && (
                          <div className="border rounded-md overflow-hidden bg-background">
                            <iframe
                              title={attachment.filename || t`PDF attachment`}
                              src={dataUrl}
                              className="w-full h-[800px] border-0"
                            />
                          </div>
                        )}

                        {hasEmbedded && isCsv && decodedText !== null && (
                          <div className="h-[800px] overflow-auto w-full rounded bg-card">
                            <CsvAttachmentTable csv={decodedText} />
                          </div>
                        )}

                        {hasEmbedded &&
                          !isCsv &&
                          isTextLike &&
                          decodedText !== null && (
                            <div className="h-[800px] overflow-auto w-full rounded border bg-card">
                              <SyntaxHighlighter
                                code={decodedText}
                                language="text"
                                className="p-4 h-full min-w-full"
                              />
                            </div>
                          )}

                        {!hasEmbedded && attachment.url && (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-3">
                              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="flex-1 text-sm break-all text-muted-foreground">
                                {attachment.url}
                              </span>
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                {t`Open link`}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        )}

                        {hasEmbedded &&
                          !isImage &&
                          !isPdf &&
                          !isCsv &&
                          (!isTextLike || decodedText === null) &&
                          dataUrl && (
                            <p className="text-sm text-muted-foreground">
                              {t`This attachment type cannot be previewed inline, but you can download it.`}
                            </p>
                          )}

                        {hasEmbedded && dataUrl && (
                          <a
                            href={dataUrl}
                            download={attachment.filename || undefined}
                            className="inline-flex items-center text-sm text-primary underline"
                          >
                            {t`Download attachment`}
                          </a>
                        )}

                        {!hasEmbedded && !attachment.url && (
                          <p className="text-sm text-muted-foreground">
                            {t`No embedded content or external reference available for this attachment.`}
                          </p>
                        )}
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>

          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {doc.validation && doc.validation.result !== "valid" && (
              <Card className="border-destructive/30 bg-destructive/5 dark:border-destructive/50 dark:bg-destructive/10">
                <CardHeader>
                  <CardTitle>{t`Document Validation Issues`}</CardTitle>
                  <CardDescription className="text-foreground">
                    {t`This document has validation errors that need attention.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ValidationDetails
                    validation={doc.validation as ValidationResponse}
                  />
                </CardContent>
              </Card>
            )}

            {relatedDocuments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t`Related documents`}</CardTitle>
                  <CardDescription>
                    {t`Documents with the referenced envelope ID.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingRelated ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {relatedDocuments.map((relatedDoc) => {
                        const relatedParsed: any = relatedDoc.parsed;
                        const relatedDocumentNumber =
                          relatedParsed?.invoiceNumber ??
                          relatedParsed?.creditNoteNumber ??
                          relatedParsed?.selfBillingInvoiceNumber ??
                          relatedParsed?.selfBillingCreditNoteNumber ??
                          relatedParsed?.id;
                        const relatedTitle =
                          relatedDocumentNumber ||
                          `${relatedDoc.id.slice(0, 6)}...${relatedDoc.id.slice(-6)}`;

                        return (
                          <div
                            key={relatedDoc.id}
                            onClick={() =>
                              navigate(
                                `/transmitted-documents/${relatedDoc.id}`
                              )
                            }
                            className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-default"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-primary text-left w-full truncate">
                                {relatedTitle}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="capitalize">
                                  {relatedDoc.type}
                                </span>
                                <span>•</span>
                                <span className="capitalize">
                                  {relatedDoc.direction}
                                </span>
                                <span>•</span>
                                <span>
                                  {new Date(
                                    relatedDoc.createdAt
                                  ).toLocaleString(language, {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t`Technical details & raw data`}</CardTitle>
                <CardDescription>
                  {hasStructuredData && hasXml
                    ? t`Inspect metadata, parsed JSON structure, or the original XML payload.`
                    : hasStructuredData
                      ? t`Inspect metadata or the parsed JSON structure.`
                      : hasXml
                        ? t`Inspect metadata or the original XML payload.`
                        : t`Inspect document metadata.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="metadata">
                  <TabsList className="flex w-full gap-2 mb-3">
                    <TabsTrigger value="metadata" className="flex-1">
                      {t`Metadata`}
                    </TabsTrigger>
                    {hasStructuredData && (
                      <TabsTrigger value="json" className="flex-1">
                        {t`JSON`}
                      </TabsTrigger>
                    )}
                    {hasXml && (
                      <TabsTrigger value="xml" className="flex-1">
                        {t`XML`}
                      </TabsTrigger>
                    )}
                  </TabsList>
                  <TabsContent value="metadata">
                    <div className="grid grid-cols-1 gap-3 text-xs md:text-sm">
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Document ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.id}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Company ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.companyId}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Sender ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.senderId}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Receiver ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.receiverId}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`DocType ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.docTypeId}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Process ID`}</div>
                        <div className="font-mono text-xs break-all">
                          {doc.processId}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">
                          {t`Country (C1)`}
                        </div>
                        <div className="font-mono text-xs break-all">
                          {doc.countryC1}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-muted-foreground">{t`Attachments`}</div>
                        {attachments.length === 0 && (
                          <div className="text-xs text-muted-foreground">
                            {t`No attachments found on this document.`}
                          </div>
                        )}
                        {attachments.length > 0 && (
                          <div className="space-y-1">
                            {attachments.map((attachment, index) => (
                              <div
                                key={
                                  attachment.id ??
                                  `${attachment.filename}-${index}`
                                }
                                className="rounded border px-2 py-1 bg-muted/40"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <div className="font-mono text-xs break-all">
                                    {attachment.filename ||
                                      t`Unnamed attachment`}
                                  </div>
                                  {attachment.mimeCode && (
                                    <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                                      {attachment.mimeCode}
                                    </span>
                                  )}
                                </div>
                                {attachment.description && (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {attachment.description}
                                  </div>
                                )}
                                {attachment.url && (
                                  <div className="mt-0.5 text-xs">
                                    <a
                                      href={attachment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-primary underline break-all"
                                    >
                                      {t`Open external reference`}
                                    </a>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {(doc.peppolMessageId ||
                        doc.peppolConversationId ||
                        doc.receivedPeppolSignalMessage ||
                        doc.envelopeId) && (
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              className="w-full font-normal [&[data-state=open]>svg]:rotate-180"
                            >
                              <span className="text-sm font-medium">
                                {t`Advanced`}
                              </span>
                              <ChevronDown className="h-4 w-4 transition-transform duration-200" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="grid grid-cols-1 gap-3 text-xs md:text-sm">
                              {doc.peppolMessageId && (
                                <div className="space-y-1">
                                  <div className="text-muted-foreground">
                                    {t`Peppol Message ID`}
                                  </div>
                                  <div className="font-mono text-xs break-all">
                                    {doc.peppolMessageId}
                                  </div>
                                </div>
                              )}
                              {doc.peppolConversationId && (
                                <div className="space-y-1">
                                  <div className="text-muted-foreground">
                                    {t`Peppol Conversation ID`}
                                  </div>
                                  <div className="font-mono text-xs break-all">
                                    {doc.peppolConversationId}
                                  </div>
                                </div>
                              )}
                              {doc.receivedPeppolSignalMessage && (
                                <div className="space-y-1">
                                  <div className="text-muted-foreground">
                                    {t`Received Peppol Signal Message`}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        if (!doc.receivedPeppolSignalMessage)
                                          return;
                                        const blob = new Blob(
                                          [doc.receivedPeppolSignalMessage],
                                          { type: "application/xml" }
                                        );
                                        const url =
                                          window.URL.createObjectURL(blob);
                                        const link =
                                          window.document.createElement("a");
                                        link.href = url;
                                        link.download = `received-peppol-signal-message-${doc.id}.xml`;
                                        window.document.body.appendChild(link);
                                        link.click();
                                        window.document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                        toast.success(t`XML downloaded`);
                                      }}
                                    >
                                      <ArrowDown className="h-4 w-4 mr-2" />
                                      {t`Download XML`}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        if (!doc.receivedPeppolSignalMessage)
                                          return;
                                        navigator.clipboard.writeText(
                                          doc.receivedPeppolSignalMessage
                                        );
                                        toast.success(
                                          t`XML copied to clipboard`
                                        );
                                      }}
                                    >
                                      <Copy className="h-4 w-4 mr-2" />
                                      {t`Copy XML`}
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {doc.envelopeId && (
                                <div className="space-y-1">
                                  <div className="text-muted-foreground">
                                    {t`Envelope ID`}
                                  </div>
                                  <div className="font-mono text-xs break-all">
                                    {doc.envelopeId}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  </TabsContent>
                  {hasStructuredData && (
                    <TabsContent value="json">
                      <div className="space-y-2">
                        <div className="h-[320px] overflow-auto w-full rounded-md border bg-card">
                          <SyntaxHighlighter
                            code={JSON.stringify(parsed, null, 2)}
                            language="json"
                            className="p-4 h-full min-w-full"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              JSON.stringify(parsed, null, 2)
                            );
                            toast.success(t`JSON copied to clipboard`);
                          }}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t`Copy JSON`}
                        </Button>
                      </div>
                    </TabsContent>
                  )}
                  {hasXml && (
                    <TabsContent value="xml">
                      <div className="space-y-2">
                        <div className="h-[320px] overflow-auto w-full rounded-md border bg-card">
                          <SyntaxHighlighter
                            code={doc.xml ?? ""}
                            language="xml"
                            className="p-4 h-full min-w-full"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            navigator.clipboard.writeText(doc.xml ?? "");
                            toast.success(t`XML copied to clipboard`);
                          }}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t`Copy XML`}
                        </Button>
                      </div>
                    </TabsContent>
                  )}
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageTemplate>
  );
}
