import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import { useEffect, useState, useCallback } from "react";
import { DataTable } from "@core/components/data-table";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { SortingState } from "@tanstack/react-table";
import { useDataTableState } from "@core/hooks/use-data-table-state";
import { Button } from "@core/components/ui/button";
import { toast } from "@core/components/ui/sonner";
import { useActiveTeam } from "@core/hooks/user";
import { Loader2, Tag, X, Pencil, Trash2 } from "lucide-react";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { stringifyActionFailure } from "@recommand/lib/utils";
import type { Suppliers } from "@peppol/api/suppliers";
import type { Labels } from "@peppol/api/labels";
import { DataTablePagination } from "@core/components/data-table/pagination";
import {
  DataTableToolbar,
  type FilterConfig,
} from "@core/components/data-table/toolbar";
import { LabelBadge } from "@peppol/components/label-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@core/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@core/components/ui/dialog";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { AsyncButton } from "@core/components/async-button";
import type { Label as LabelType } from "@peppol/types/label";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Suppliers>("v1");
const labelsClient = rc<Labels>("v1");

type Supplier = {
  id: string;
  teamId: string;
  externalId: string | null;
  name: string;
  vatNumber: string | null;
  peppolAddresses: string[];
  createdAt: string;
  updatedAt: string;
  labels?: Omit<LabelType, "teamId" | "createdAt" | "updatedAt">[];
};

type SupplierFormData = {
  id?: string;
  name: string;
  externalId: string | null;
  vatNumber: string | null;
  peppolAddresses: string[];
};

const defaultSupplierFormData: SupplierFormData = {
  name: "",
  externalId: null,
  vatNumber: null,
  peppolAddresses: [],
};

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
    tableId: "suppliers",
    defaultLimit: 10,
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [labels, setLabels] = useState<LabelType[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [formData, setFormData] = useState<SupplierFormData>(defaultSupplierFormData);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const activeTeam = useActiveTeam();

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
      toast.error(t`Failed to load labels`);
      setLabels([]);
    }
  }, [activeTeam?.id]);

  const fetchSuppliers = useCallback(async () => {
    if (!activeTeam?.id) {
      setSuppliers([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await client[":teamId"]["suppliers"].$get({
        param: { teamId: activeTeam.id },
        query: {
          page,
          limit,
          search: globalFilter || undefined,
        },
      });
      const json = await response.json();

      if (!json.success) {
        toast.error(t`Failed to load suppliers`);
        setSuppliers([]);
        setTotal(0);
      } else {
        setSuppliers(json.suppliers.map((supplier) => ({
          ...supplier,
          peppolAddresses: supplier.peppolAddresses || [],
        })));
        setTotal(json.pagination?.total || 0);
      }
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast.error(t`Failed to load suppliers`);
      setSuppliers([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [activeTeam?.id, page, limit, columnFilters, globalFilter]);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  useEffect(() => {
    setIsLoading(true);
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleAssignLabel = async (supplierId: string, labelId: string) => {
    if (!activeTeam?.id) return;

    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) return;

    const label = labels.find((l) => l.id === labelId);
    if (!label) return;

    const isAlreadyAssigned = supplier.labels?.some((l) => l.id === labelId);
    if (isAlreadyAssigned) return;

    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === supplierId
          ? {
              ...s,
              labels: [
                ...(s.labels || []), label
              ]
            }
          : s
      )
    );

    try {
      const response = await client[":teamId"]["suppliers"][":supplierId"]["labels"][":labelId"].$post({
        param: {
          teamId: activeTeam.id,
          supplierId,
          labelId,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
    } catch (error) {
      setSuppliers((prev) =>
        prev.map((s) =>
          s.id === supplierId
            ? { ...s, labels: s.labels?.filter((l) => l.id !== labelId) || [] }
            : s
        )
      );
      toast.error(t`Failed to assign label`);
    }
  };

  const handleUnassignLabel = async (supplierId: string, labelId: string) => {
    if (!activeTeam?.id) return;

    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) return;

    const isAssigned = supplier.labels?.some((l) => l.id === labelId);
    if (!isAssigned) return;

    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === supplierId
          ? { ...s, labels: s.labels?.filter((l) => l.id !== labelId) || [] }
          : s
      )
    );

    try {
      const response = await client[":teamId"]["suppliers"][":supplierId"]["labels"][":labelId"].$delete({
        param: {
          teamId: activeTeam.id,
          supplierId,
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
        setSuppliers((prev) =>
          prev.map((s) =>
            s.id === supplierId
              ? {
                  ...s,
                  labels: [
                    ...(s.labels || []),
                    label
                  ]
                }
              : s
          )
        );
      }
      toast.error(t`Failed to unassign label`);
    }
  };

  const handleUpsertSupplier = async () => {
    if (!activeTeam?.id) {
      toast.error(t`No active team selected`);
      return;
    }

    if (!formData.name.trim()) {
      toast.error(t`Name is required`);
      return;
    }

    try {
      const response = await client[":teamId"]["suppliers"].$post({
        param: { teamId: activeTeam.id },
        json: {
          ...formData,
          id: dialogMode === "edit" && editingSupplier ? editingSupplier.id : undefined,
        },
      });

      const json = await response.json();
      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
        return;
      }

      toast.success(
        dialogMode === "edit" ? t`Supplier updated successfully` : t`Supplier created successfully`
      );

      setFormData(defaultSupplierFormData);
      setEditingSupplier(null);
      setIsDialogOpen(false);
      fetchSuppliers();
    } catch (error) {
      console.error("Error upserting supplier:", error);
      toast.error(t`Failed to save supplier`);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!activeTeam?.id) return;

    if (!confirm(t`Are you sure you want to delete this supplier? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await (client[":teamId"]["suppliers"][":supplierId"] as any).$delete({
        param: {
          teamId: activeTeam.id,
          supplierId: id,
        },
      });

      const json = await response.json();
      if (!json.success) {
        toast.error(stringifyActionFailure(json.errors));
        return;
      }

      toast.success(t`Supplier deleted successfully`);
      fetchSuppliers();
    } catch (error) {
      console.error("Error deleting supplier:", error);
      toast.error(t`Failed to delete supplier`);
    }
  };

  const columns: ColumnDef<Supplier>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <ColumnHeader column={column} title={t`Name`} />,
      meta: { label: t`Name` },
      cell: ({ row }) => {
        const name = row.getValue("name") as string;
        return <span>{name}</span>;
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "vatNumber",
      header: ({ column }) => <ColumnHeader column={column} title={t`VAT Number`} />,
      meta: { label: t`VAT Number` },
      cell: ({ row }) => {
        const vatNumber = row.getValue("vatNumber") as string | null;
        return vatNumber ? <span>{vatNumber}</span> : <span className="text-muted-foreground">-</span>;
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "peppolAddresses",
      header: ({ column }) => <ColumnHeader column={column} title={t`Peppol Addresses`} />,
      meta: { label: t`Peppol Addresses` },
      cell: ({ row }) => {
        const peppolAddresses = row.getValue("peppolAddresses") as string[];
        return (
          <div className="flex flex-col gap-1">
            {peppolAddresses.length > 0 ? (
              peppolAddresses.map((address, index) => (
                <span key={index} className="font-mono text-xs">{address}</span>
              ))
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        );
      },
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
      accessorKey: "labels",
      header: ({ column }) => <ColumnHeader column={column} title={t`Labels`} />,
      meta: { label: t`Labels` },
      cell: ({ row }) => {
        const supplierLabels = row.original.labels || [];
        const supplierId = row.original.id;

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {supplierLabels.map((label) => (
              <LabelBadge
                key={label.id}
                name={label.name}
                colorHex={label.colorHex}
                onRemove={() => handleUnassignLabel(supplierId, label.id)}
              />
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" title={t`Add label`}>
                  <Tag className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <div className="p-2">
                  <div className="text-sm font-medium mb-2">{t`Assign Labels`}</div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {labels
                      .filter((label) => !supplierLabels.some((l) => l.id === label.id))
                      .map((label) => (
                        <button
                          key={label.id}
                          onClick={() => {
                            handleAssignLabel(supplierId, label.id);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded-md text-left"
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: label.colorHex }}
                          />
                          <span className="flex-1">{label.name}</span>
                        </button>
                      ))}
                    {labels.filter((label) => !supplierLabels.some((l) => l.id === label.id)).length === 0 && (
                      <div className="text-sm text-muted-foreground px-2 py-1.5">
                        {t`No available labels`}
                      </div>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
        const supplier = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditingSupplier(supplier);
                setFormData({
                  id: supplier.id,
                  name: supplier.name,
                  externalId: supplier.externalId,
                  vatNumber: supplier.vatNumber,
                  peppolAddresses: supplier.peppolAddresses || [],
                });
                setDialogMode("edit");
                setIsDialogOpen(true);
              }}
              title={t`Edit`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <AsyncButton
              variant="ghost-destructive"
              size="icon"
              onClick={async () => await handleDeleteSupplier(supplier.id)}
              title={t`Delete`}
            >
              <Trash2 className="h-4 w-4" />
            </AsyncButton>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: suppliers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      pagination: paginationState,
    },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange,
    pageCount: Math.ceil(total / limit),
    manualPagination: true,
    manualFiltering: true,
  });

  const filterConfigs: FilterConfig<Supplier>[] = [];

  const addPeppolAddress = () => {
    setFormData({
      ...formData,
      peppolAddresses: [...formData.peppolAddresses, ""],
    });
  };

  const updatePeppolAddress = (index: number, value: string) => {
    const updated = [...formData.peppolAddresses];
    updated[index] = value;
    setFormData({ ...formData, peppolAddresses: updated });
  };

  const removePeppolAddress = (index: number) => {
    setFormData({
      ...formData,
      peppolAddresses: formData.peppolAddresses.filter((_, i) => i !== index),
    });
  };

  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Suppliers` }]}
      description={t`View and manage your suppliers (supporting data).`}
      buttons={[
        <Dialog
          key="upsert-supplier-dialog"
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
        >
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setDialogMode("create");
                setFormData(defaultSupplierFormData);
                setEditingSupplier(null);
              }}
            >
              {t`Create Supplier`}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "create" ? t`Create New Supplier` : t`Edit Supplier`}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === "create"
                  ? t`Create a new supplier with the details below.`
                  : t`Update the supplier details below.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t`Name *`}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="externalId">{t`External ID`}</Label>
                <Input
                  id="externalId"
                  value={formData.externalId || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, externalId: e.target.value || null })
                  }
                  placeholder={t`Optional external identifier`}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vatNumber">{t`VAT Number`}</Label>
                <Input
                  id="vatNumber"
                  value={formData.vatNumber || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, vatNumber: e.target.value || null })
                  }
                  placeholder={t`Optional VAT number`}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t`Peppol Addresses`}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addPeppolAddress}
                  >
                    {t`Add Address`}
                  </Button>
                </div>
                <div className="space-y-2">
                  {formData.peppolAddresses.map((address, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={address}
                        onChange={(e) => updatePeppolAddress(index, e.target.value)}
                        placeholder={t`e.g. 0208:1012081766`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePeppolAddress(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {formData.peppolAddresses.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t`No Peppol addresses added. Click "Add Address" to add one.`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setFormData(defaultSupplierFormData);
                    setEditingSupplier(null);
                  }}
                >
                  {t`Cancel`}
                </Button>
                <AsyncButton type="submit" onClick={handleUpsertSupplier}>
                  {dialogMode === "edit" ? t`Save Changes` : t`Create Supplier`}
                </AsyncButton>
              </div>
            </div>
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
          <>
            <DataTableToolbar
              table={table}
              searchPlaceholder={t`Search suppliers...`}
              enableGlobalSearch
              filterColumns={filterConfigs}
            />
            <DataTable columns={columns} table={table} />
            <DataTablePagination table={table} />
          </>
        )}
      </div>
    </PageTemplate>
  );
}
