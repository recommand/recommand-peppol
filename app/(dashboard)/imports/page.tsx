import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { FileUp, Loader2, Mail, Upload } from "lucide-react";
import { PageTemplate } from "@core/components/page-template";
import { DataTable } from "@core/components/data-table";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { DataTableToolbar, type FilterConfig } from "@core/components/data-table/toolbar";
import { Button } from "@core/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@core/components/ui/empty";
import { toast } from "@core/components/ui/sonner";
import { useDataTableState } from "@core/hooks/use-data-table-state";
import { useActiveTeam, useHasPermission } from "@core/hooks/user";
import { useTranslation } from "@core/hooks/use-translation";
import { ImportStatusLabel } from "@peppol/components/imports/import-status";
import { UploadImportDialog } from "@peppol/components/imports/upload-import-dialog";
import {
  type Import,
  type ImportStatus,
  importStatusLabel,
  isImportFinished,
  type Page,
  v2Request,
} from "@peppol/lib/client/intake";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import { useCompanies } from "@peppol/lib/client/use-companies";

const STATUSES: ImportStatus[] = ["queued", "processing", "completed", "partially_completed", "failed", "ignored"];
const PAGE_SIZE = 50;
const POLL_MS = 3000;

export default function ImportsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeTeam = useActiveTeam();
  const companies = useCompanies();
  const canRead = useHasPermission(PEPPOL_PERMISSIONS.IMPORTS_READ);
  const canUpload = useHasPermission(PEPPOL_PERMISSIONS.IMPORTS_WRITE);
  const { columnFilters, setColumnFilters, columnVisibility, setColumnVisibility } = useDataTableState({
    tableId: "imports",
  });
  const [{ imports, nextCursor }, setList] = useState<{ imports: Import[]; nextCursor: string | null }>({
    imports: [],
    nextCursor: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  const filterValues = (id: string) => (columnFilters.find((filter) => filter.id === id)?.value as string[]) ?? [];
  // Saved filters can name companies of another team; only those of the active team count.
  const companyFilter = filterValues("companyId")
    .filter((id) => companies?.some((company) => company.id === id))
    .join(",");
  const statusFilter = filterValues("status").join(",");
  const teamId = activeTeam?.id;

  const load = useCallback(
    async (cursor?: string, refresh = false) => {
      if (!teamId || !canRead || companies === null) {
        setIsLoading(false);
        return;
      }
      const query = new URLSearchParams({ teamId, limit: String(PAGE_SIZE) });
      if (companyFilter) query.set("companyId", companyFilter);
      if (statusFilter) query.set("statuses", statusFilter);
      if (cursor) query.set("cursor", cursor);
      try {
        const page = await v2Request<Page<Import>>(`/imports?${query}`);
        setList((current) => {
          if (cursor) return { imports: [...current.imports, ...page.data], nextCursor: page.nextCursor };
          // A refresh replaces the first page and keeps the older rows loaded with "Load more".
          const oldest = page.data.at(-1)?.id;
          const older = refresh && page.nextCursor && oldest ? current.imports.filter((row) => row.id < oldest) : [];
          return older.length > 0
            ? { imports: [...page.data, ...older], nextCursor: current.nextCursor }
            : { imports: page.data, nextCursor: page.nextCursor };
        });
      } catch (error) {
        toast.error(t`Failed to load imports: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [teamId, canRead, companies, companyFilter, statusFilter, t],
  );

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  // Follow the imports that are still being processed.
  const hasActive = imports.some((row) => !isImportFinished(row.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => load(undefined, true), POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const companyNames = useMemo(
    () => new Map((companies ?? []).map((company) => [company.id, company.name])),
    [companies],
  );

  const columns = useMemo<ColumnDef<Import>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => <ColumnHeader column={column} title={t`Received`} />,
        meta: { label: t`Received`, cellClassName: "whitespace-nowrap" },
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        accessorKey: "companyId",
        header: ({ column }) => <ColumnHeader column={column} title={t`Company`} />,
        meta: { label: t`Company` },
        cell: ({ row }) => companyNames.get(row.original.companyId) ?? row.original.companyId,
      },
      {
        id: "source",
        header: ({ column }) => <ColumnHeader column={column} title={t`Source`} />,
        meta: { label: t`Source` },
        cell: ({ row }) => {
          const { source } = row.original;
          return (
            <div className="flex items-center gap-2">
              {source.channel === "email" ? <Mail className="h-4 w-4 shrink-0" /> : <Upload className="h-4 w-4 shrink-0" />}
              <span className="truncate max-w-56">{source.channel === "email" ? (source.from ?? t`Email`) : t`Upload`}</span>
            </div>
          );
        },
      },
      {
        id: "files",
        header: ({ column }) => <ColumnHeader column={column} title={t`Files`} />,
        meta: { label: t`Files`, cellClassName: "max-w-72 truncate" },
        cell: ({ row }) =>
          row.original.files
            .filter((file) => file.mediaType !== "message/rfc822")
            .map((file) => file.filename)
            .join(", ") || "—",
      },
      {
        accessorKey: "status",
        header: ({ column }) => <ColumnHeader column={column} title={t`Status`} />,
        meta: { label: t`Status` },
        cell: ({ row }) => <ImportStatusLabel status={row.original.status} />,
      },
      {
        id: "documents",
        header: ({ column }) => <ColumnHeader column={column} title={t`Documents`} />,
        meta: { label: t`Documents`, cellClassName: "text-right" },
        cell: ({ row }) => row.original.resultCounts.documents,
      },
      {
        id: "failed",
        header: ({ column }) => <ColumnHeader column={column} title={t`Failed`} />,
        meta: { label: t`Failed`, cellClassName: "text-right" },
        cell: ({ row }) => row.original.resultCounts.failed,
      },
    ],
    [companyNames, t],
  );

  const table = useReactTable({
    data: imports,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    state: { columnFilters, columnVisibility },
    manualFiltering: true,
  });

  const filterConfigs = useMemo<FilterConfig<Import>[]>(
    () => [
      {
        id: "companyId",
        title: t`Company`,
        options: (companies ?? []).map((company) => ({ label: company.name, value: company.id })),
      },
      {
        id: "status",
        title: t`Status`,
        options: STATUSES.map((value) => ({ label: importStatusLabel(t, value), value })),
      },
    ],
    [companies, t],
  );

  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Imports` }]}
      description={t`Documents uploaded or received by email, and how they were processed into incoming documents.`}
      buttons={
        canUpload && companies
          ? [
              <UploadImportDialog
                key="upload"
                companies={companies}
                defaultCompanyId={companyFilter.split(",")[0] || companies[0]?.id || null}
                onUploaded={(created) => navigate(`/imports/${created.id}`)}
              />,
            ]
          : []
      }
    >
      {!canRead ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t`You do not have permission to see imports`}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : isLoading || companies === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : imports.length === 0 && columnFilters.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileUp />
            </EmptyMedia>
            <EmptyTitle>{t`No imports yet`}</EmptyTitle>
            <EmptyDescription>
              {t`Upload a PDF or XML document, or give the company an inbound email address on its page.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          <DataTableToolbar table={table} filterColumns={filterConfigs} />
          <DataTable
            columns={columns}
            table={table}
            rowProps={(row) => ({ className: "cursor-pointer", onClick: () => navigate(`/imports/${row.original.id}`) })}
          />
          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => load(nextCursor)}>
                {t`Load more`}
              </Button>
            </div>
          )}
        </div>
      )}
    </PageTemplate>
  );
}
