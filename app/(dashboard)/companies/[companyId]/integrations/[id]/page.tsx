import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import type { Integrations } from "@peppol/api/integrations";
import type { Companies } from "@peppol/api/companies";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@core/components/ui/button";
import { toast } from "@core/components/ui/sonner";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useActiveTeam } from "@core/hooks/user";
import { Loader2, CheckCircle2, XCircle, Save, Trash2, RotateCcw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { DataTable } from "@core/components/data-table";
import { ConfirmDialog } from "@core/components/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@core/components/ui/table";
import type { IntegrationState } from "@peppol/types/integration";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { SortingState } from "@tanstack/react-table";
import { useDataTableState } from "@core/hooks/use-data-table-state";
import { DataTablePagination } from "@core/components/data-table/pagination";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { Badge } from "@core/components/ui/badge";
import { getBuiltInIntegration, getIntegrationEventDescription } from "@peppol/utils/integrations";
import BearerAuthentication from "@peppol/components/integrations/authentication/bearer-authentication";
import CapabilitiesConfiguration from "@peppol/components/integrations/capabilities/capabilities-configuration";
import FieldsConfiguration from "@peppol/components/integrations/fields/fields-configuration";
import type { Integration, IntegrationTaskLog } from "@peppol/types/integration";
import { AsyncButton } from "@core/components/async-button";
import { Popover, PopoverContent, PopoverTrigger } from "@core/components/ui/popover";
import { useTranslation } from "@core/hooks/use-translation";

const integrationsClient = rc<Integrations>("peppol");
const companiesClient = rc<Companies>("peppol");

type Company = {
  id: string;
  name: string;
};

export default function IntegrationDetailPage() {
  const { t, language } = useTranslation();
  const { companyId, id } = useParams<{ companyId: string; id: string }>();
  const navigate = useNavigate();

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
    tableId: `integration-${id}-task-logs`,
    defaultLimit: 10,
  });

  const [integration, setIntegration] = useState<Integration | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [taskLogs, setTaskLogs] = useState<IntegrationTaskLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [total, setTotal] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const activeTeam = useActiveTeam();

  const fetchIntegration = useCallback(async () => {
    if (!id || !activeTeam?.id) return;

    try {
      setIsLoading(true);
      const response = await integrationsClient[":teamId"]["integrations"][":integrationId"].$get({
        param: {
          teamId: activeTeam.id,
          integrationId: id,
        },
      });
      const json = await response.json();

      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
        navigate("/companies");
        return;
      }

      const integrationData = json.integration as Integration;
      
      if (companyId && integrationData.companyId !== companyId) {
        toast.error(t`Integration does not belong to this company`);
        navigate("/companies");
        return;
      }
      
      setIntegration(integrationData);

      const companyResponse = await companiesClient[":teamId"]["companies"][":companyId"].$get({
        param: {
          teamId: activeTeam.id,
          companyId: integrationData.companyId,
        },
      });
      const companyJson = await companyResponse.json();

      if (!companyJson.success) {
        toast.error(t`Failed to load company`);
        navigate("/companies");
        return;
      }

      setCompany(companyJson.company as Company);
    } catch (error) {
      console.error("Error fetching integration:", error);
      toast.error(t`Failed to load integration`);
      navigate("/companies");
    } finally {
      setIsLoading(false);
    }
  }, [id, activeTeam?.id, navigate]);

  const fetchTaskLogs = useCallback(async () => {
    if (!id || !activeTeam?.id) return;

    try {
      setIsLoadingLogs(true);
      const response = await integrationsClient[":teamId"]["integrations"][":integrationId"]["task-logs"].$get({
        param: {
          teamId: activeTeam.id,
          integrationId: id,
        },
        query: {
          page,
          limit,
        },
      });
      const json = await response.json();

      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
        return;
      }

      setTaskLogs(json.logs || []);
      setTotal(json.pagination?.total || 0);
    } catch (error) {
      console.error("Error fetching task logs:", error);
      toast.error(t`Failed to load task logs`);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [id, activeTeam?.id, page, limit]);

  useEffect(() => {
    if (id && activeTeam?.id) {
      fetchIntegration();
    }
  }, [id, activeTeam?.id, fetchIntegration]);

  useEffect(() => {
    if (id && activeTeam?.id) {
      fetchTaskLogs();
    }
  }, [id, activeTeam?.id, page, limit, fetchTaskLogs]);

  const handleSaveIntegration = useCallback(async () => {
    if (!id || !activeTeam?.id || !integration) return;

    if (!integration.configuration) {
      toast.error(t`Integration configuration is required. Please configure the integration first.`);
      return;
    }

    try {
      const response = await integrationsClient[":teamId"]["integrations"][":integrationId"].$put({
        param: {
          teamId: activeTeam.id,
          integrationId: id,
        },
        json: {
          companyId: integration.companyId,
          configuration: integration.configuration,
        },
      });

      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      const updatedIntegration = json.integration as Integration;
      setIntegration(updatedIntegration);
      toast.success(t`Integration updated successfully`);
    } catch (error) {
      console.error("Error updating integration:", error);
      toast.error(t`Failed to update integration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [id, activeTeam?.id, integration, t]);

  const handleDeleteIntegration = useCallback(async () => {
    if (!id || !activeTeam?.id) return;

    try {
      setIsDeleting(true);
      const response = await integrationsClient[":teamId"]["integrations"][":integrationId"].$delete({
        param: {
          teamId: activeTeam.id,
          integrationId: id,
        },
      });

      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`Integration deleted successfully`);
      navigate(`/companies/${company?.id || ""}`);
    } catch (error) {
      console.error("Error deleting integration:", error);
      toast.error(t`Failed to delete integration: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  }, [id, activeTeam?.id, navigate, company?.id, t]);

  const handleResetState = useCallback(async () => {
    if (!id || !activeTeam?.id) return;

    try {
      setIsResetting(true);
      const response = await integrationsClient[":teamId"]["integrations"][":integrationId"]["reset-state"].$post({
        param: {
          teamId: activeTeam.id,
          integrationId: id,
        },
      });

      const json = await response.json();

      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(t`Integration state reset successfully`);
      await fetchIntegration();
    } catch (error) {
      console.error("Error resetting integration state:", error);
      toast.error(t`Failed to reset integration state: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsResetting(false);
    }
  }, [id, activeTeam?.id, fetchIntegration, t]);

  function MessageCell({ message }: { message: string }) {
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);

    return (
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <div
            className="max-w-[300px] truncate cursor-pointer"
            onMouseEnter={() => setIsPopoverOpen(true)}
            onMouseLeave={() => setIsPopoverOpen(false)}
          >
            {message}
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-96 max-w-[90vw]"
          align="start"
          onMouseEnter={() => setIsPopoverOpen(true)}
          onMouseLeave={() => setIsPopoverOpen(false)}
        >
          <div className="text-sm whitespace-pre-wrap break-words">{message}</div>
        </PopoverContent>
      </Popover>
    );
  }

  const columns: ColumnDef<IntegrationTaskLog>[] = [
    {
      accessorKey: "event",
      header: ({ column }) => <ColumnHeader column={column} title={t`Event`} />,
      cell: ({ row }) => {
        const event = row.getValue("event") as string;
        const eventDescription = getIntegrationEventDescription(event);
        const eventName = eventDescription?.title ? t(eventDescription.title) : event;
        return (
          <div className="font-medium">{eventName}</div>
        );
      },
    },
    {
      accessorKey: "task",
      header: ({ column }) => <ColumnHeader column={column} title={t`Task`} />,
      cell: ({ row }) => (
        <div className="max-w-[200px] truncate">{row.getValue("task")}</div>
      ),
    },
    {
      accessorKey: "success",
      header: ({ column }) => <ColumnHeader column={column} title={t`Status`} />,
      cell: ({ row }) => {
        const success = row.getValue("success") as boolean;
        return (
          <Badge variant={success ? "default" : "destructive"} className="gap-1">
            {success ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {success ? t`Success` : t`Failed`}
          </Badge>
        );
      },
    },
    {
      accessorKey: "message",
      header: ({ column }) => <ColumnHeader column={column} title={t`Message`} />,
      cell: ({ row }) => {
        const message = row.getValue("message") as string;
        return <MessageCell message={message} />;
      },
    },
    {
      accessorKey: "context",
      header: ({ column }) => <ColumnHeader column={column} title={t`Context`} />,
      cell: ({ row }) => {
        const context = row.getValue("context") as string;
        return (
          <div className="max-w-[200px] truncate text-muted-foreground">
            {context || "-"}
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <ColumnHeader column={column} title={t`Created At`} />,
      cell: ({ row }) => {
        const date = row.getValue("createdAt") as string;
        return (
          <div>
            {new Date(date).toLocaleString(language, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: taskLogs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: paginationState,
    },
    onPaginationChange,
    pageCount: Math.ceil(total / limit),
    manualPagination: true,
    manualFiltering: true,
  });

  if (isLoading) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: "Peppol", href: "/" },
          { label: t`Companies`, href: "/companies" },
          { label: t`Loading...` },
        ]}
        description={t`Loading integration details...`}
      >
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" />
            <div className="text-lg">{t`Loading integration details...`}</div>
          </div>
        </div>
      </PageTemplate>
    );
  }

  if (!integration || !company) {
    return (
      <PageTemplate
        breadcrumbs={[
          { label: "Peppol", href: "/" },
          { label: t`Companies`, href: "/companies" },
          { label: t`Not Found` },
        ]}
        description={t`Integration not found`}
      >
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="text-lg mb-4">{t`Integration not found`}</div>
            <Button onClick={() => navigate("/companies")}>
              {t`Back to Companies`}
            </Button>
          </div>
        </div>
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      breadcrumbs={[
        { label: "Peppol", href: "/" },
        { label: t`Companies`, href: "/companies" },
        { label: company.name, href: `/companies/${company.id}` },
        { label: t(integration.manifest.name) },
      ]}
      description={
        getBuiltInIntegration(integration.manifest.url)?.description
          ? t(getBuiltInIntegration(integration.manifest.url)!.description)
          : ""
      }
      buttons={[
        <ConfirmDialog
          key="delete-button"
          title={t`Delete Integration`}
          description={t`Are you sure you want to delete this integration? This action cannot be undone.`}
          confirmButtonText={t`Delete`}
          onConfirm={handleDeleteIntegration}
          isLoading={isDeleting}
          variant="destructive"
          trigger={
            <Button variant="destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              {t`Delete`}
            </Button>
          }
        />,
        <AsyncButton
          key="save-button"
          onClick={handleSaveIntegration}
        >
          <Save className="h-4 w-4 mr-2" />
          {t`Save Changes`}
        </AsyncButton>,
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t`Authentication`}</CardTitle>
                <CardDescription>
                  {t`Configure authentication settings`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <BearerAuthentication integration={integration} onChange={setIntegration} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t`Configuration`}</CardTitle>
                <CardDescription>
                  {t`Make configuration changes to the integration`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FieldsConfiguration integration={integration} onChange={setIntegration} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t`Capabilities`}</CardTitle>
                <CardDescription>
                  {t`Enable or disable integration capabilities`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CapabilitiesConfiguration integration={integration} onChange={setIntegration} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t`Task Logs`}</CardTitle>
                <CardDescription>
                  {t`Recent integration task execution logs`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingLogs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : taskLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>{t`No task logs available`}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <DataTable columns={columns} table={table} />
                  <DataTablePagination table={table} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t`Advanced`}</CardTitle>
                <CardDescription>
                  {t`View and manage integration state`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 text-sm font-medium">{t`Integration State`}</div>
                {integration.state && typeof integration.state === "object" && integration.state !== null && Object.keys(integration.state as IntegrationState).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t`Key`}</TableHead>
                        <TableHead>{t`Value`}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(integration.state as IntegrationState).map(([key, value]) => (
                        <TableRow key={key}>
                          <TableCell className="font-mono text-xs">{key}</TableCell>
                          <TableCell className="font-mono text-xs break-all">{value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>{t`No state data available`}</p>
                  </div>
                )}
              </div>
              <ConfirmDialog
                title={t`Reset Integration State`}
                description={t`Are you sure you want to reset the integration state? This will clear all stored state data.`}
                confirmButtonText={t`Reset State`}
                onConfirm={handleResetState}
                isLoading={isResetting}
                variant="default"
                trigger={
                  <Button variant="outline">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t`Reset State`}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTemplate>
  );
}
