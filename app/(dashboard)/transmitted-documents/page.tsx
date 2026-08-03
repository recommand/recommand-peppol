import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { DataTable } from "@core/components/data-table";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { useDataTableState } from "@core/hooks/use-data-table-state";
import { Button } from "@core/components/ui/button";
import { toast } from "@core/components/ui/sonner";
import { useActiveTeam } from "@core/hooks/user";
import { Trash2, Loader2, Copy, ArrowDown, ArrowUp, FolderArchive, Tag, CheckCheck, Mail, MailOpen, Download } from "lucide-react";
import { useIsPlayground } from "@peppol/lib/client/playgrounds";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { stringifyActionFailure } from "@recommand/lib/utils";
import type { TransmittedDocumentWithoutBody } from "@peppol/data/transmitted-documents";
import type { TransmittedDocuments } from "@peppol/api/documents";
import type { Companies } from "@peppol/api/companies";
import type { Labels } from "@peppol/api/labels";
import { DataTablePagination } from "@core/components/data-table/pagination";
import {
  DataTableToolbar,
  type FilterConfig,
} from "@core/components/data-table/toolbar";
import { PartyInfoTooltip } from "@peppol/components/party-info-tooltip";
import { TransmissionStatusIcons } from "@peppol/components/transmission-status-icons";
import { DocumentTypeCell } from "@peppol/components/document-type-cell";
import { LabelBadge } from "@peppol/components/label-badge";
import { DocumentLabelPicker } from "@peppol/components/document-label-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@core/components/ui/popover";
import type { Label } from "@peppol/types/label";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "@core/components/confirm-dialog";
import { ExportDocumentsDialog } from "@peppol/components/export-documents-dialog";
import {
  isReportingDocumentType,
  type SupportedDocumentType,
} from "@peppol/utils/document-types";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import { Checkbox } from "@core/components/ui/checkbox";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<TransmittedDocuments>("peppol");
const companiesClient = rc<Companies>("peppol");
const labelsClient = rc<Labels>("v1");

export default function Page() {
  const { t, language } = useTranslation();
  const {
    page,
    limit,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    paginationState,
    onPaginationChange,
  } = useDataTableState({
    tableId: "transmitted-documents",
    defaultLimit: 10,
    defaultColumnVisibility: {
      documentNumber: false,
      totalExclVat: false,
      totalInclVat: false,
      isUnread: false,
      labelId: false,
    },
  });

  const [documents, setDocuments] = useState<TransmittedDocumentWithoutBody[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const activeTeam = useActiveTeam();
  const isPlayground = useIsPlayground();
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const lastSelectedDocumentIdRef = useRef<string | null>(null);
  const isShiftClickRef = useRef(false);
  const [isBulkMarkingAsRead, setIsBulkMarkingAsRead] = useState(false);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkAssigningLabelId, setBulkAssigningLabelId] = useState<string | null>(null);

  const fetchCompanies = useCallback(async () => {
    if (!activeTeam?.id) {
      setCompanies([]);
      return;
    }

    try {
      const response = await companiesClient[":teamId"]["companies"].$get({
        param: { teamId: activeTeam.id },
        query: {},
      });
      const json = await response.json();

      if (!json.success || !Array.isArray(json.companies)) {
        toast.error(t`Failed to load companies`);
        setCompanies([]);
      } else {
        setCompanies(
          json.companies.map((company: { id: string; name: string }) => ({
            id: company.id,
            name: company.name,
          }))
        );
      }
    } catch (error) {
      toast.error(t`Failed to load companies`);
      setCompanies([]);
    }
  }, [activeTeam?.id]);

  const fetchDocuments = useCallback(async () => {
    if (!activeTeam?.id) {
      setDocuments([]);
      setIsLoading(false);
      return;
    }

    const directionFilter = columnFilters.find((f) => f.id === "direction");
    const filteredDirectionValues = directionFilter?.value as string[] ?? [];

    const companyFilter = columnFilters.find((f) => f.id === "companyId");
    const filteredCompanyIds = companyFilter?.value as string[] ?? [];

    const typeFilter = columnFilters.find((f) => f.id === "type");
    const filteredTypeValues = typeFilter?.value as string[] ?? [];

    const isUnreadFilter = columnFilters.find((f) => f.id === "isUnread");
    const filteredIsUnreadValues = isUnreadFilter?.value as string[] ?? [];

    const labelFilter = columnFilters.find((f) => f.id === "labelId");
    const filteredLabelIds = labelFilter?.value as string[] ?? [];

    try {
      const response = await client[":teamId"]["documents"].$get({
        param: { teamId: activeTeam.id },
        query: {
          page: page,
          limit: limit,
          companyId: filteredCompanyIds,
          labelId: filteredLabelIds.length > 0 ? filteredLabelIds : undefined,
          direction: ((filteredDirectionValues.length === 0 || filteredDirectionValues.length > 1) ? undefined : filteredDirectionValues[0]) as "incoming" | "outgoing", // When no or all options are selected, don't filter on direction
          search: globalFilter || undefined, // Add the global search term to the query
          type: ((filteredTypeValues.length === 0 || filteredTypeValues.length > 1) ? undefined : filteredTypeValues[0]) as SupportedDocumentType, // When no or all options are selected, don't filter on type
          isUnread: ((filteredIsUnreadValues.length === 0 || filteredIsUnreadValues.length > 1) ? undefined : filteredIsUnreadValues[0]) as "true" | "false" | undefined,
          excludeAttachments: true,
        },
      });
      const json = await response.json();

      if (!json.success) {
        console.error("Invalid API response format:", json);
        toast.error(t`Failed to load documents`);
        setDocuments([]);
      } else {
        setDocuments(
          json.documents.map((doc) => ({
            ...doc,
            readAt: doc.readAt ? new Date(doc.readAt) : null,
            createdAt: new Date(doc.createdAt),
            updatedAt: new Date(doc.updatedAt),
            labels: doc.labels || [],
          }))
        );
        setTotal(json.pagination.total);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast.error(t`Failed to load documents`);
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeTeam?.id, page, limit, columnFilters, globalFilter]);

  const fetchLabels = useCallback(async () => {
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
        toast.error(t`Failed to load labels`);
        setLabels([]);
      } else {
        setLabels(json.labels);
      }
    } catch (error) {
      console.error("Error fetching labels:", error);
      toast.error(t`Failed to load labels`);
      setLabels([]);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const visibleDocumentIds = new Set(documents.map((document) => document.id));

    if (
      lastSelectedDocumentIdRef.current &&
      !visibleDocumentIds.has(lastSelectedDocumentIdRef.current)
    ) {
      lastSelectedDocumentIdRef.current = null;
    }

    setRowSelection((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(
          ([documentId, isSelected]) => isSelected && visibleDocumentIds.has(documentId)
        )
      );

      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [documents]);

  const handleRowSelectionChange = useCallback((
    documentId: string,
    visibleDocumentIds: string[],
    isSelected: boolean
  ) => {
    const lastSelectedDocumentId = lastSelectedDocumentIdRef.current;
    const startIndex = lastSelectedDocumentId
      ? visibleDocumentIds.indexOf(lastSelectedDocumentId)
      : -1;
    const endIndex = visibleDocumentIds.indexOf(documentId);
    const shouldSelectRange =
      isShiftClickRef.current && startIndex !== -1 && endIndex !== -1;

    setRowSelection((prev) => {
      const next = { ...prev };
      const documentIds = shouldSelectRange
        ? visibleDocumentIds.slice(
            Math.min(startIndex, endIndex),
            Math.max(startIndex, endIndex) + 1
          )
        : [documentId];

      for (const id of documentIds) {
        if (isSelected) {
          next[id] = true;
        } else {
          delete next[id];
        }
      }

      return next;
    });

    lastSelectedDocumentIdRef.current = documentId;
    isShiftClickRef.current = false;
  }, []);

  const selectedDocumentIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, isSelected]) => isSelected)
        .map(([documentId]) => documentId),
    [rowSelection]
  );

  const companiesById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies]
  );

  const downloadResponseBlob = useCallback(async (response: Response, fallbackFilename: string) => {
    if (!response.ok) {
      const json = await response.json() as { errors?: { [key: string]: string[] | undefined } };
      throw new Error(json.errors ? stringifyActionFailure(json.errors) : t`Request failed`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      response.headers
        .get("Content-Disposition")
        ?.split("filename=")[1]
        ?.replaceAll('"', "") || fallbackFilename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, [t]);

  const handleDeleteDocument = useCallback(async (id: string) => {
    if (!activeTeam?.id) return;

    try {
      const response = await client[":teamId"]["documents"][
        ":documentId"
      ].$delete({
        param: {
          teamId: activeTeam.id,
          documentId: id,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
      toast.success(t`Document deleted successfully`);
      fetchDocuments();
    } catch (error) {
      toast.error(t`Failed to delete document`);
    }
  }, [activeTeam?.id, fetchDocuments, t]);

  const handleDeleteAllDocuments = useCallback(async () => {
    if (!activeTeam?.id || !isPlayground) return;

    setIsDeletingAll(true);
    try {
      const response = await client[":teamId"]["documents"]["all"].$delete({
        param: { teamId: activeTeam.id },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
      toast.success(t`All documents deleted successfully`);
      fetchDocuments();
    } catch (error) {
      toast.error(t`Failed to delete all documents`);
    } finally {
      setIsDeletingAll(false);
    }
  }, [activeTeam?.id, isPlayground, fetchDocuments, t]);

  const handleToggleMarkAsRead = useCallback(async (id: string, currentReadAt: Date | null) => {
    if (!activeTeam?.id) return;

    const isRead = currentReadAt !== null;
    const newReadStatus = !isRead;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              readAt: newReadStatus ? new Date() : null,
            }
          : doc
      )
    );

    try {
      const response = await client[":teamId"]["documents"][":documentId"]["markAsRead"].$post({
        param: {
          teamId: activeTeam.id,
          documentId: id,
        },
        json: {
          read: newReadStatus,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
      toast.success(newReadStatus ? t`Document marked as read` : t`Document marked as unread`);
      fetchDocuments();
    } catch (error) {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === id
            ? {
                ...doc,
                readAt: currentReadAt,
              }
            : doc
        )
      );
      toast.error(t`Failed to update document read status`);
    }
  }, [activeTeam?.id, fetchDocuments, t]);

  const handleDownloadDocument = useCallback(async (id: string) => {
    if (!activeTeam?.id) return;

    try {
      const response = await client[":teamId"]["documents"][":documentId"]["downloadPackage"].$get({
        param: {
          teamId: activeTeam.id,
          documentId: id,
        },
        query: {
          generatePdf: "always",
        },
      });
      await downloadResponseBlob(response, `${id}.zip`);

      toast.success(t`Document downloaded successfully`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Failed to download document`);
    }
  }, [activeTeam?.id, downloadResponseBlob, t]);

  const handleAssignLabel = useCallback(async (documentId: string, labelId: string) => {
    if (!activeTeam?.id) return;

    const document = documents.find((d) => d.id === documentId);
    if (!document) return;

    const label = labels.find((l) => l.id === labelId);
    if (!label) return;

    const isAlreadyAssigned = document.labels?.some((l) => l.id === labelId);
    if (isAlreadyAssigned) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === documentId
          ? {
            ...doc,
            labels: [
              ...(doc.labels || []), label
            ]
          }
          : doc
      )
    );

    try {
      const response = await client[":teamId"]["documents"][":documentId"]["labels"][":labelId"].$post({
        param: {
          teamId: activeTeam.id,
          documentId,
          labelId,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
    } catch (error) {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === documentId
            ? { ...doc, labels: doc.labels?.filter((l) => l.id !== labelId) || [] }
            : doc
        )
      );
      toast.error(t`Failed to assign label`);
    }
  }, [activeTeam?.id, documents, labels, t]);

  const handleUnassignLabel = useCallback(async (documentId: string, labelId: string) => {
    if (!activeTeam?.id) return;

    const document = documents.find((d) => d.id === documentId);
    if (!document) return;

    const isAssigned = document.labels?.some((l) => l.id === labelId);
    if (!isAssigned) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === documentId
          ? { ...doc, labels: doc.labels?.filter((l) => l.id !== labelId) || [] }
          : doc
      )
    );

    try {
      const response = await client[":teamId"]["documents"][":documentId"]["labels"][":labelId"].$delete({
        param: {
          teamId: activeTeam.id,
          documentId,
          labelId,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
    } catch (error) {
      const label = labels.find((l) => l.id === labelId);
      if (label) {
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === documentId
              ? {
                ...doc,
                labels: [
                  ...(doc.labels || []),
                  label
                ]
              }
              : doc
          )
        );
      }
      toast.error(t`Failed to unassign label`);
    }
  }, [activeTeam?.id, documents, labels, t]);

  const handleBulkMarkAsRead = useCallback(async () => {
    if (!activeTeam?.id || selectedDocumentIds.length === 0) return;

    const previousReadAtById = new Map(
      documents
        .filter((document) => selectedDocumentIds.includes(document.id))
        .map((document) => [document.id, document.readAt] as const)
    );

    setIsBulkMarkingAsRead(true);
    setDocuments((prev) =>
      prev.map((document) =>
        selectedDocumentIds.includes(document.id)
          ? {
              ...document,
              readAt: document.readAt ?? new Date(),
            }
          : document
      )
    );

    try {
      const response = await client[":teamId"]["documents"]["bulk-mark-as-read"].$post({
        param: { teamId: activeTeam.id },
        json: {
          documentIds: selectedDocumentIds,
          read: true,
        },
      });
      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`${selectedDocumentIds.length} documents marked as read`);
      fetchDocuments();
    } catch (error) {
      setDocuments((prev) =>
        prev.map((document) =>
          previousReadAtById.has(document.id)
            ? {
                ...document,
                readAt: previousReadAtById.get(document.id) ?? null,
              }
            : document
        )
      );
      toast.error(error instanceof Error ? error.message : t`Failed to mark documents as read`);
    } finally {
      setIsBulkMarkingAsRead(false);
    }
  }, [activeTeam?.id, documents, selectedDocumentIds, fetchDocuments, t]);

  const handleBulkAssignLabel = useCallback(async (labelId: string) => {
    if (!activeTeam?.id || selectedDocumentIds.length === 0) return;

    const label = labels.find((entry) => entry.id === labelId);

    if (!label) {
      toast.error(t`Label not found`);
      return;
    }

    const previousLabelsById = new Map(
      documents
        .filter((document) => selectedDocumentIds.includes(document.id))
        .map((document) => [document.id, document.labels || []] as const)
    );

    setBulkAssigningLabelId(labelId);
    setDocuments((prev) =>
      prev.map((document) => {
        if (!selectedDocumentIds.includes(document.id)) {
          return document;
        }

        const hasLabel = document.labels?.some((existingLabel) => existingLabel.id === labelId);

        if (hasLabel) {
          return document;
        }

        return {
          ...document,
          labels: [...(document.labels || []), label],
        };
      })
    );

    try {
      const response = await client[":teamId"]["documents"]["bulk-assign-label"][":labelId"].$post({
        param: {
          teamId: activeTeam.id,
          labelId,
        },
        json: {
          documentIds: selectedDocumentIds,
        },
      });
      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`Label added to ${selectedDocumentIds.length} documents`);
      fetchDocuments();
    } catch (error) {
      setDocuments((prev) =>
        prev.map((document) =>
          previousLabelsById.has(document.id)
            ? {
                ...document,
                labels: previousLabelsById.get(document.id) || [],
              }
            : document
        )
      );
      toast.error(error instanceof Error ? error.message : t`Failed to assign label`);
    } finally {
      setBulkAssigningLabelId(null);
    }
  }, [activeTeam?.id, documents, labels, selectedDocumentIds, fetchDocuments, t]);

  const handleBulkExport = useCallback(async (outputType: "flat" | "nested") => {
    if (!activeTeam?.id || selectedDocumentIds.length === 0) return;

    setIsBulkExporting(true);

    try {
      const response = await client[":teamId"]["documents"]["bulk-export"].$post({
        param: { teamId: activeTeam.id },
        json: {
          documentIds: selectedDocumentIds,
          outputType,
          generatePdf: "never",
        },
      });

      await downloadResponseBlob(response, "documents-selection.zip");
      toast.success(t`Documents exported successfully`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Failed to export documents`);
    } finally {
      setIsBulkExporting(false);
    }
  }, [activeTeam?.id, selectedDocumentIds, downloadResponseBlob, t]);

  const handleBulkDelete = useCallback(async () => {
    if (!activeTeam?.id || selectedDocumentIds.length === 0) return;

    setIsBulkDeleting(true);

    try {
      const response = await client[":teamId"]["documents"]["bulk-delete"].$delete({
        param: { teamId: activeTeam.id },
        json: {
          documentIds: selectedDocumentIds,
        },
      });
      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`${selectedDocumentIds.length} documents deleted`);
      fetchDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Failed to delete documents`);
      throw error;
    } finally {
      setIsBulkDeleting(false);
    }
  }, [activeTeam?.id, selectedDocumentIds, fetchDocuments, t]);

  const columns = useMemo<ColumnDef<TransmittedDocumentWithoutBody>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={t`Select all rows`}
        />
      ),
      cell: ({ row, table }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onClickCapture={(event) => {
            isShiftClickRef.current = event.shiftKey;
          }}
          onCheckedChange={(value) => handleRowSelectionChange(
            row.id,
            table.getRowModel().rows.map((visibleRow) => visibleRow.id),
            !!value
          )}
          aria-label={t`Select row`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      enableGlobalFilter: false,
      size: 36,
    },
    {
      accessorKey: "id",
      header: ({ column }) => <ColumnHeader column={column} title={t`ID`} />,
      meta: { label: t`ID` },
      cell: ({ row }) => {
        const id = row.getValue("id") as string;
        return (
          <div className="flex items-center gap-2">
            <Link
              to={`/transmitted-documents/${id}`}
              className="font-mono text-xs hover:underline"
            >
              {id.slice(0, 6)}...{id.slice(-6)}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(id);
                toast.success(t`Document ID copied to clipboard`);
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        );
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "companyId",
      header: ({ column }) => <ColumnHeader column={column} title={t`Company`} />,
      meta: { label: t`Company` },
      cell: ({ row }) => {
        const companyId = row.original.companyId;
        return companiesById.get(companyId) ?? companyId;
      },
      enableColumnFilter: false,
      enableGlobalFilter: true,
    },
    {
      accessorKey: "type",
      header: ({ column }) => <ColumnHeader column={column} title={t`Type`} />,
      meta: { label: t`Type` },
      cell: ({ row }) => {
        const document = row.original;
        const type = row.getValue("type") as string;
        const validation = document.validation;

        return <DocumentTypeCell type={type} validation={validation} />;
      },
      enableGlobalFilter: true,
    },
    {
      id: "documentNumber",
      accessorFn: (row) => {
        const parsed = row.parsed;
        if (!parsed) return null;
        return (parsed as any)?.invoiceNumber ?? (parsed as any)?.creditNoteNumber ?? null;
      },
      header: ({ column }) => <ColumnHeader column={column} title={t`Document Number`} />,
      meta: { label: t`Document Number` },
      cell: ({ row }) => {
        const parsed = row.original.parsed;
        const documentNumber = parsed ? ((parsed as any)?.invoiceNumber ?? (parsed as any)?.creditNoteNumber ?? null) : null;
        const id = row.original.id;
        return (
          <Link
            to={`/transmitted-documents/${id}`}
            className={documentNumber ? "hover:underline" : "text-muted-foreground hover:underline"}
          >
            {documentNumber ?? "-"}
          </Link>
        );
      },
      enableHiding: true,
      enableGlobalFilter: true,
    },
    {
      accessorKey: "senderId",
      header: ({ column }) => <ColumnHeader column={column} title={t`Sender`} />,
      meta: { label: t`Sender` },
      cell: ({ row }) => {
        const document = row.original;
        const senderId = row.getValue("senderId") as string;
        const documentType = document.type;

        // Check if document type is recognized and has parsed data
        const isRecognizedType = ["invoice", "creditNote", "selfBillingInvoice", "selfBillingCreditNote"].includes(documentType);

        if (isRecognizedType && document.parsed) {
          // For billing documents, sender is the seller, for self-billing documents, sender is the buyer
          const senderInfo = ["invoice", "creditNote"].includes(documentType)
            ? (document.parsed as Invoice | CreditNote)?.seller
            : ["selfBillingInvoice", "selfBillingCreditNote"].includes(documentType) ? (document.parsed as SelfBillingInvoice | SelfBillingCreditNote)?.buyer : undefined;

          if (senderInfo?.name) {
            return (
              <div className="flex items-center gap-2">
                <span>{senderInfo.name}</span>
                <PartyInfoTooltip partyInfo={senderInfo} peppolAddress={senderId} />
              </div>
            );
          }
        }

        // Fallback to showing senderId for unrecognized types or missing parsed data
        return <span>{senderId}</span>;
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "receiverId",
      header: ({ column }) => <ColumnHeader column={column} title={t`Receiver`} />,
      meta: { label: t`Receiver` },
      cell: ({ row }) => {
        const document = row.original;
        const receiverId = row.getValue("receiverId") as string;
        const documentType = document.type;
        const sentOverPeppol = document.sentOverPeppol;
        const sentOverEmail = document.sentOverEmail;
        const emailRecipients = document.emailRecipients;
        const isReporting = isReportingDocumentType(documentType);

        // Check if document type is recognized and has parsed data
        const isRecognizedType = ["invoice", "creditNote", "selfBillingInvoice", "selfBillingCreditNote"].includes(documentType);

        if (isRecognizedType && document.parsed) {
          // For billing documents, receiver is the buyer, for self-billing documents, receiver is the seller
          const receiverInfo = ["invoice", "creditNote"].includes(documentType)
            ? (document.parsed as any)?.buyer
            : (document.parsed as any)?.seller;

          if (receiverInfo?.name) {
            return (
              <div className="flex items-center gap-2">
                <span>{receiverInfo.name}</span>
                <div className="flex items-center gap-1">
                  <PartyInfoTooltip partyInfo={receiverInfo} peppolAddress={receiverId} />
                  <TransmissionStatusIcons
                    sentOverPeppol={sentOverPeppol}
                    sentOverEmail={sentOverEmail}
                    emailRecipients={emailRecipients || undefined}
                    isReporting={isReporting}
                  />
                </div>
              </div>
            );
          }
        }

        // Fallback to showing receiverId for unrecognized types or missing parsed data
        return (
          <div className="flex items-center gap-2">
            <span>{receiverId}</span>
            <TransmissionStatusIcons
              sentOverPeppol={sentOverPeppol}
              sentOverEmail={sentOverEmail}
              emailRecipients={emailRecipients || undefined}
              isReporting={isReporting}
            />
          </div>
        );
      },
      enableGlobalFilter: true,
    },
    {
      id: "totalExclVat",
      accessorFn: (row) => {
        const parsed = row.parsed;
        if (!parsed) return null;
        const totals = (parsed as any)?.totals;
        return totals?.taxExclusiveAmount ? parseFloat(totals.taxExclusiveAmount) : null;
      },
      header: ({ column }) => <ColumnHeader column={column} title={t`Total Excl. VAT`} />,
      meta: { label: t`Total Excl. VAT` },
      cell: ({ row }) => {
        const parsed = row.original.parsed;
        if (!parsed) {
          return <span className="text-muted-foreground">-</span>;
        }
        const totals = (parsed as any)?.totals;
        if (totals?.taxExclusiveAmount) {
          const amount = String(totals.taxExclusiveAmount);
          const currency = (parsed as any)?.currency || "EUR";
          return <span className="font-mono">{amount} {currency}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
      enableHiding: true,
      enableGlobalFilter: false,
    },
    {
      id: "totalInclVat",
      accessorFn: (row) => {
        const parsed = row.parsed;
        if (!parsed) return null;
        const totals = (parsed as any)?.totals;
        return totals?.taxInclusiveAmount ? parseFloat(totals.taxInclusiveAmount) : null;
      },
      header: ({ column }) => <ColumnHeader column={column} title={t`Total Incl. VAT`} />,
      meta: { label: t`Total Incl. VAT` },
      cell: ({ row }) => {
        const parsed = row.original.parsed;
        if (!parsed) {
          return <span className="text-muted-foreground">-</span>;
        }
        const totals = (parsed as any)?.totals;
        if (totals?.taxInclusiveAmount) {
          const amount = String(totals.taxInclusiveAmount);
          const currency = (parsed as any)?.currency || "EUR";
          return <span className="font-mono">{amount} {currency}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
      enableHiding: true,
      enableGlobalFilter: false,
    },
    {
      accessorKey: "direction",
      header: ({ column }) => (
        <ColumnHeader column={column} title={t`Direction`} />
      ),
      meta: { label: t`Direction` },
      cell: ({ row }) => {
        const direction = row.getValue("direction") as string;
        return (
          <div className="flex items-center gap-1">
            {direction === "incoming" ? (
              <ArrowDown className="h-4 w-4" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
            <span>{direction === "incoming" ? t`Incoming` : t`Outgoing`}</span>
          </div>
        );
      },
      filterFn: "equals",
      enableGlobalFilter: true,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <ColumnHeader column={column} title={t`Created At`} />
      ),
      meta: { label: t`Created At` },
      cell: ({ row }) => {
        const date = row.getValue("createdAt") as string;
        return new Date(date).toLocaleString(language, {
          dateStyle: "medium",
          timeStyle: "medium",
        });
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "readAt",
      header: ({ column }) => <ColumnHeader column={column} title={t`Read At`} />,
      meta: { label: t`Read At` },
      cell: ({ row }) => {
        const date = row.getValue("readAt") as string;
        return date ? (
          new Date(date).toLocaleString(language, {
            dateStyle: "medium",
            timeStyle: "medium",
          })
        ) : (
          <p className="text-muted-foreground">-</p>
        );
      },
      enableGlobalFilter: true,
    },
    {
      id: "isUnread",
      accessorFn: (row) => (row.readAt === null ? "true" : "false"),
      header: () => null,
      cell: () => null,
      enableHiding: false,
      filterFn: (row, _id, value) => {
        if (!value || value.length === 0) return true;
        const isUnread = row.original.readAt === null;
        return value.includes(isUnread ? "true" : "false");
      },
    },
    {
      id: "labelId",
      accessorFn: (row) => row.labels?.map((label) => label.id) || [],
      header: () => null,
      cell: () => null,
      enableHiding: false,
      filterFn: (row, _id, value) => {
        if (!value || value.length === 0) return true;
        const documentLabelIds = row.original.labels?.map((label) => label.id) || [];
        return value.some((labelId: string) => documentLabelIds.includes(labelId));
      },
    },
    {
      accessorKey: "labels",
      header: ({ column }) => <ColumnHeader column={column} title={t`Labels`} />,
      meta: { label: t`Labels` },
      cell: ({ row }) => {
        const documentLabels = row.original.labels || [];
        const documentId = row.original.id;

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {documentLabels.map((label) => (
              <LabelBadge
                key={label.id}
                name={label.name}
                colorHex={label.colorHex}
                onRemove={() => handleUnassignLabel(documentId, label.id)}
              />
            ))}
            <DocumentLabelPicker
              labels={labels}
              assignedLabels={documentLabels}
              onAssign={(label) => handleAssignLabel(documentId, label.id)}
              title={t`Assign Labels`}
              trigger={
                <Button variant="ghost" size="icon" title={t`Add label`}>
                  <Tag className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        );
      },
      enableGlobalFilter: true,
    },
    {
      id: "actions",
      header: "",
      size: 100,
      cell: ({ row }) => {
        const id = row.original.id;
        if (!id) return null;

        const isRead = row.original.readAt !== null;

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleToggleMarkAsRead(id, row.original.readAt)}
              title={isRead ? t`Mark as unread` : t`Mark as read`}
            >
              {isRead ? (
                <CheckCheck className="h-4 w-4 opacity-30" />
              ) : (
                <CheckCheck className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDownloadDocument(id)}
              title={t`Download document package`}
            >
              <FolderArchive className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost-destructive"
              size="icon"
              onClick={() => handleDeleteDocument(id)}
              title={t`Delete document`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ], [
    companiesById,
    handleAssignLabel,
    handleDeleteDocument,
    handleDownloadDocument,
    handleRowSelectionChange,
    handleToggleMarkAsRead,
    handleUnassignLabel,
    labels,
    t,
  ]);

  const table = useReactTable({
    data: documents,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      pagination: paginationState,
      rowSelection,
    },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange,
    pageCount: Math.ceil(total / limit),
    manualPagination: true,
    manualFiltering: true,
  });

  const filterConfigs = useMemo<FilterConfig<TransmittedDocumentWithoutBody>[]>(() => [
    {
      id: "companyId",
      title: t`Company`,
      options: companies.map((company) => ({
        label: company.name,
        value: company.id,
      })),
    },
    {
      id: "direction",
      title: t`Direction`,
      options: [
        { label: t`Incoming`, value: "incoming", icon: ArrowDown },
        { label: t`Outgoing`, value: "outgoing", icon: ArrowUp },
      ],
    },
    {
      id: "type",
      title: t`Type`,
      options: [
        { label: t`Invoice`, value: "invoice" },
        { label: t`Credit Note`, value: "creditNote" },
        { label: t`Self Billing Invoice`, value: "selfBillingInvoice" },
        { label: t`Self Billing Credit Note`, value: "selfBillingCreditNote" },
        { label: t`Message Level Response`, value: "messageLevelResponse" },
        { label: t`French Invoicing CDAR`, value: "frenchInvoicingCdar" },
        { label: t`French B2C Sales Report`, value: "frenchB2CSalesReport" },
        { label: t`French B2C Payment Report`, value: "frenchB2CPaymentReport" },
        { label: t`Unknown`, value: "unknown" },
      ],
    },
    {
      id: "isUnread",
      title: t`Read Status`,
      options: [
        { label: t`Unread`, value: "true", icon: Mail },
        { label: t`Read`, value: "false", icon: MailOpen },
      ],
    },
    {
      id: "labelId",
      title: t`Label`,
      options: labels.map((label) => ({
        label: label.name,
        value: label.id,
      })),
    },
  ], [companies, labels, t]);

  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Sent and received documents` }]}
      description={t`View and manage your transmitted Peppol documents.`}
      buttons={[
        <Button
          key="export"
          variant="outline"
          onClick={() => setIsExportDialogOpen(true)}
        >
          <Download className="h-4 w-4 mr-2" />
          {t`Export`}
        </Button>,
        ...(isPlayground
          ? [
              <ConfirmDialog
                key="delete-all"
                title={t`Delete All Documents`}
                description={t`Are you sure you want to delete all documents? This action cannot be undone. All documents in this playground will be permanently removed.`}
                confirmButtonText={t`Delete All`}
                onConfirm={handleDeleteAllDocuments}
                isLoading={isDeletingAll}
                trigger={
                  <Button variant="destructive" disabled={isDeletingAll}>
                    {isDeletingAll ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t`Deleting...`}
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t`Delete All`}
                      </>
                    )}
                  </Button>
                }
              />,
            ]
          : []),
      ]}
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DataTableToolbar
              table={table}
              searchPlaceholder={t`Search documents...`}
              enableGlobalSearch
              throttleGlobalSearch
              filterColumns={filterConfigs}
            />
            {selectedDocumentIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
                <span className="text-sm text-muted-foreground">
                  {t`${selectedDocumentIds.length} selected`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkMarkAsRead}
                  disabled={isBulkMarkingAsRead || isBulkExporting || isBulkDeleting || bulkAssigningLabelId !== null}
                >
                  {isBulkMarkingAsRead ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="mr-2 h-4 w-4" />
                  )}
                  {t`Mark as read`}
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBulkMarkingAsRead || isBulkExporting || isBulkDeleting || bulkAssigningLabelId !== null}
                    >
                      {bulkAssigningLabelId ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Tag className="mr-2 h-4 w-4" />
                      )}
                      {t`Add label`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <div className="p-2">
                      <div className="mb-2 text-sm font-medium">{t`Assign label`}</div>
                      <div className="max-h-64 space-y-1 overflow-y-auto">
                        {labels.map((label) => (
                          <button
                            key={label.id}
                            onClick={() => handleBulkAssignLabel(label.id)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                          >
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: label.colorHex }}
                            />
                            <span className="flex-1">{label.name}</span>
                          </button>
                        ))}
                        {labels.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            {t`No labels available`}
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBulkMarkingAsRead || isBulkExporting || isBulkDeleting || bulkAssigningLabelId !== null}
                    >
                      {isBulkExporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {t`Download ZIP`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <div className="space-y-1">
                      <button
                        onClick={() => handleBulkExport("flat")}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <FolderArchive className="h-4 w-4" />
                        <span>{t`Flat UBL ZIP`}</span>
                      </button>
                      <button
                        onClick={() => handleBulkExport("nested")}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <FolderArchive className="h-4 w-4" />
                        <span>{t`Nested ZIP`}</span>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                <ConfirmDialog
                  title={t`Delete Selected Documents`}
                  description={t`Are you sure you want to delete ${selectedDocumentIds.length} selected documents? This action cannot be undone.`}
                  confirmButtonText={t`Delete`}
                  onConfirm={handleBulkDelete}
                  isLoading={isBulkDeleting}
                  trigger={
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isBulkMarkingAsRead || isBulkExporting || isBulkDeleting || bulkAssigningLabelId !== null}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t`Delete`}
                    </Button>
                  }
                />
              </div>
            )}
            <DataTable columns={columns} table={table} />
            <DataTablePagination table={table} />
          </>
        )}
      </div>
      <ExportDocumentsDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
      />
    </PageTemplate>
  );
}
