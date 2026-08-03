import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import type { GetTeamExtension } from "@peppol/api/teams/get-team-extension";
import { useEffect, useState, useCallback } from "react";
import { DataTable } from "@core/components/data-table";
import {
  type ColumnDef,
  type Column,
  type Row,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { SortingState } from "@tanstack/react-table";
import { useDataTableState } from "@core/hooks/use-data-table-state";
import { Button } from "@core/components/ui/button";
import { toast } from "@core/components/ui/sonner";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useActiveTeam } from "@core/hooks/user";
import { useNavigate } from "react-router-dom";
import { Trash2, Loader2, Pencil, Copy } from "lucide-react";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { VerificationStatusIcon } from "../../../components/verification-status-icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@core/components/ui/dialog";
import { CreateCompanyWizard } from "../../../components/create-company-wizard";
import type { Company } from "../../../types/company";
import { DataTableToolbar } from "@core/components/data-table/toolbar";
import { DataTablePagination } from "@core/components/data-table/pagination";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "@core/components/confirm-dialog";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("peppol");
const teamsClient = rc<GetTeamExtension>("v1");

// Utility function to handle API responses
const handleApiResponse = async (
  response: Response,
  successMessage: string
) => {
  const json = await response.json();
  if (!json.success) {
    toast.error(stringifyActionFailure(json.errors));
    throw new Error(stringifyActionFailure(json.errors));
  }else{
    toast.success(successMessage);
  }
  return json;
};

// Utility function to create column definition
const createColumn = (
  key: keyof Company,
  title: string,
  emptyValue: string
): ColumnDef<Company> => ({
  accessorKey: key,
  header: ({ column }) => <ColumnHeader column={column} title={title} />,
  meta: { label: title },
  cell: ({ row }) => (row.getValue(key) as string) ?? emptyValue,
  enableGlobalFilter: true,
});

export default function Page() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const {
    columnVisibility,
    setColumnVisibility,
    paginationState,
    onPaginationChange,
  } = useDataTableState({
    tableId: "companies",
    defaultLimit: 10,
  });

  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [companyCreatedInSession, setCompanyCreatedInSession] = useState(false);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [verificationRequirements, setVerificationRequirements] = useState<"strict" | "trusted" | "lax" | null>(null);
  const activeTeam = useActiveTeam();

  const fetchCompanies = useCallback(async () => {
    if (!activeTeam?.id) {
      setCompanies([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await client[":teamId"]["companies"].$get({
        param: { teamId: activeTeam.id },
        query: {},
      });
      const json = await response.json();

      if (!json.success || !Array.isArray(json.companies)) {
        console.error("Invalid API response format:", json);
        toast.error(t`Failed to load companies`);
        setCompanies([]);
      } else {
        setCompanies(json.companies);
      }
    } catch (error) {
      console.error("Error fetching companies:", error);
      toast.error(t`Failed to load companies`);
      setCompanies([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeTeam?.id]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    if (activeTeam?.id) {
      fetchTeamExtension();
    }
  }, [activeTeam?.id]);

  const fetchTeamExtension = async () => {
    if (!activeTeam?.id) return;

    try {
      const response = await teamsClient[":teamId"]["team-extension"].$get({
        param: { teamId: activeTeam.id },
      });
      const data = await response.json();

      if (data.success) {
        setVerificationRequirements(data.verificationRequirements);
      }
    } catch (error) {
      console.error("Error fetching team extension:", error);
    }
  };

  const handleWizardComplete = (company: Company) => {
    setCompanies((prev) => [...prev, company]);
    setCompanyCreatedInSession(true);
    setIsDialogOpen(false);
    toast.success(t`Company created successfully`);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open && companyCreatedInSession) {
      setCompanyCreatedInSession(false);
      fetchCompanies();
    }
  };

  const handleDeleteCompany = async (id: string) => {
    if (!activeTeam?.id) return;

    try {
      setDeletingCompanyId(id);
      const response = await client[":teamId"]["companies"][
        ":companyId"
      ].$delete({
        param: {
          teamId: activeTeam.id,
          companyId: id,
        },
      });
      await handleApiResponse(response, t`Company deleted successfully`);
      fetchCompanies();
    } catch (error) {
      console.error("Error deleting company:", error);
    } finally {
      setDeletingCompanyId(null);
    }
  };

  const columns: ColumnDef<Company>[] = [
    {
      accessorKey: "id",
      header: ({ column }) => <ColumnHeader column={column} title={t`ID`} />,
      meta: { label: t`ID` },
      cell: ({ row }) => {
        const id = row.getValue("id") as string;
        return (
          <div className="flex items-center gap-2">
            <Link
              to={`/companies/${id}`}
              className="p-0 h-auto font-mono text-xs hover:underline"
            >
              {id.slice(0, 6)}...{id.slice(-6)}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(id);
                toast.success(t`Company ID copied to clipboard`);
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
      accessorKey: "name",
      header: ({ column }) => <ColumnHeader column={column} title={t`Name`} />,
      meta: { label: t`Name` },
      cell: ({ row }) => {
        const name = row.getValue("name") as string;
        const id = row.original.id;
        return (
          <Link
            to={`/companies/${id}`}
            className="p-0 h-auto font-normal text-left hover:underline"
          >
            {name}
          </Link>
        );
      },
      enableGlobalFilter: true,
    },
    createColumn("enterpriseNumber", t`Enterprise Number`, t`N/A`),
    createColumn("city", t`City`, t`N/A`),
    createColumn("country", t`Country`, t`N/A`),
    ...(verificationRequirements && (verificationRequirements === "strict" || verificationRequirements === "lax")
      ? [
          {
            accessorKey: "isVerified",
            header: ({ column }: { column: Column<Company> }) => <ColumnHeader column={column} title={t`Verification`} />,
            meta: { label: t`Verification` },
            cell: ({ row }: { row: Row<Company> }) => {
              const isVerified = row.getValue("isVerified") as boolean;
              return <VerificationStatusIcon isVerified={isVerified} />;
            },
            enableGlobalFilter: false,
          } as ColumnDef<Company>,
        ]
      : []),
    {
      id: "actions",
      header: "",
      size: 100,
      cell: ({ row }) => {
        const id = row.original.id;
        if (!id) return null;

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/companies/${id}`)}
              title={t`Edit`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <ConfirmDialog
              title={t`Delete Company`}
              description={t`Are you sure you want to delete this company? This action cannot be undone.`}
              confirmButtonText={t`Delete`}
              onConfirm={async () => await handleDeleteCompany(id)}
              isLoading={deletingCompanyId === id}
              variant="destructive"
              trigger={
                <Button
                  variant="ghost-destructive"
                  size="icon"
                  title={t`Delete`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: companies,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      pagination: paginationState,
    },
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Companies` }]}
      description={t`Add all companies for which you want to send or receive Peppol documents.`}
      buttons={[
        <Dialog
          key="create-company-dialog"
          open={isDialogOpen}
          onOpenChange={handleDialogOpenChange}
        >
          <DialogTrigger asChild>
            <Button>
              {t`Create Company`}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px]">
            <DialogHeader>
              <DialogTitle>{t`Create New Company`}</DialogTitle>
            </DialogHeader>
            {activeTeam && (
              <CreateCompanyWizard
                teamId={activeTeam.id}
                verificationRequirements={verificationRequirements}
                onComplete={handleWizardComplete}
                onCancel={() => setIsDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>,
      ]}
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <DataTableToolbar table={table} enableGlobalSearch />
            <DataTable columns={columns} table={table} />
            <DataTablePagination table={table} />
          </div>
        )}
      </div>
    </PageTemplate>
  );
}
