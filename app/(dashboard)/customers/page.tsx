import { PageTemplate } from "@core/components/page-template";
import { rc } from "@recommand/lib/client";
import { useEffect, useState, useCallback, useMemo } from "react";
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
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { ColumnHeader } from "@core/components/data-table/column-header";
import { stringifyActionFailure } from "@recommand/lib/utils";
import type { Customers } from "@peppol/api/customers";
import { DataTablePagination } from "@core/components/data-table/pagination";
import {
  DataTableToolbar,
  type FilterConfig,
} from "@core/components/data-table/toolbar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { COUNTRIES } from "@peppol/utils/countries";
import { useTranslation } from "@core/hooks/use-translation";
import { createRegionNames, regionDisplayName, sortByRegionDisplayName } from "@core/lib/regions";

const client = rc<Customers>("v1");

type Customer = {
  id: string;
  teamId: string;
  externalId: string | null;
  name: string;
  vatNumber: string | null;
  enterpriseNumber: string | null;
  peppolAddresses: string[];
  address: string;
  city: string;
  postalCode: string;
  country: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerFormData = {
  id?: string;
  externalId: string | null;
  name: string;
  vatNumber: string | null;
  enterpriseNumber: string | null;
  peppolAddresses: string[];
  address: string;
  city: string;
  postalCode: string;
  country: string;
  email: string | null;
  phone: string | null;
};

const defaultCustomerFormData: CustomerFormData = {
  externalId: null,
  name: "",
  vatNumber: null,
  enterpriseNumber: null,
  peppolAddresses: [],
  address: "",
  city: "",
  postalCode: "",
  country: "BE",
  email: null,
  phone: null,
};

export default function Page() {
  const { t, language } = useTranslation();
  const regionNames = useMemo(
    () => createRegionNames(language),
    [language]
  );
  const countryOptions = useMemo(
    () => sortByRegionDisplayName(COUNTRIES, regionNames),
    [regionNames]
  );
  const {
    page,
    setPage,
    limit,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    paginationState,
    onPaginationChange,
  } = useDataTableState({
    tableId: "customers",
    defaultLimit: 10,
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [formData, setFormData] = useState<CustomerFormData>(
    defaultCustomerFormData
  );
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const activeTeam = useActiveTeam();

  const fetchCustomers = useCallback(async () => {
    if (!activeTeam?.id) {
      setCustomers([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await client[":teamId"]["customers"].$get({
        param: { teamId: activeTeam.id },
        query: {
          page,
          limit,
          search: globalFilter || undefined,
        },
      });
      const json = await response.json();

      if (!json.success) {
        toast.error(t`Failed to load customers`);
        setCustomers([]);
        setTotal(0);
      } else {
        setCustomers(
          (Array.isArray(json.customers) ? json.customers : []).map(
            (customer: any) => ({
              ...customer,
              peppolAddresses: Array.isArray(customer.peppolAddresses)
                ? customer.peppolAddresses
                : [],
            })
          )
        );
        setTotal(json.pagination?.total || 0);
      }
    } catch (error) {
      console.error("Error fetching customers:", error);
      toast.error(t`Failed to load customers`);
      setCustomers([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [activeTeam?.id, page, limit, globalFilter, columnFilters]);

  useEffect(() => {
    setIsLoading(true);
    fetchCustomers();
  }, [fetchCustomers]);

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

  const handleUpsertCustomer = async () => {
    if (!activeTeam?.id) return;

    try {
      const response = await client[":teamId"]["customers"].$post({
        param: { teamId: activeTeam.id },
        json: {
          ...(dialogMode === "edit" && editingCustomer?.id
            ? { id: editingCustomer.id }
            : {}),
          name: formData.name,
          externalId: formData.externalId,
          vatNumber: formData.vatNumber,
          enterpriseNumber: formData.enterpriseNumber,
          peppolAddresses: formData.peppolAddresses.filter((a) => a.trim()),
          address: formData.address,
          city: formData.city,
          postalCode: formData.postalCode,
          country: formData.country,
          email: formData.email,
          phone: formData.phone,
        },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }

      toast.success(
        dialogMode === "create"
          ? t`Customer created successfully`
          : t`Customer updated successfully`
      );
      setIsDialogOpen(false);
      setFormData(defaultCustomerFormData);
      setEditingCustomer(null);
      setPage(1);
      setIsLoading(true);
      fetchCustomers();
    } catch (error) {
      console.error("Error upserting customer:", error);
      toast.error(t`Failed to save customer`);
    }
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    if (!activeTeam?.id) return;
    const confirmed = window.confirm(
      t`Are you sure you want to delete customer "${customer.name}"?`
    );
    if (!confirmed) return;

    try {
      const response = await (
        client[":teamId"]["customers"][":customerId"] as any
      ).$delete({
        param: { teamId: activeTeam.id, customerId: customer.id },
      });
      const json = await response.json();
      if (!json.success) {
        throw new Error(stringifyActionFailure(json.errors));
      }
      toast.success(t`Customer deleted successfully`);
      setIsLoading(true);
      fetchCustomers();
    } catch (error) {
      console.error("Error deleting customer:", error);
      toast.error(t`Failed to delete customer`);
    }
  };

  const columns: ColumnDef<Customer>[] = [
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
      header: ({ column }) => (
        <ColumnHeader column={column} title={t`VAT Number`} />
      ),
      meta: { label: t`VAT Number` },
      cell: ({ row }) => {
        const vatNumber = row.getValue("vatNumber") as string | null;
        return vatNumber ? (
          <span>{vatNumber}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "peppolAddresses",
      header: ({ column }) => (
        <ColumnHeader column={column} title={t`Peppol Addresses`} />
      ),
      meta: { label: t`Peppol Addresses` },
      cell: ({ row }) => {
        const peppolAddresses = row.getValue("peppolAddresses") as string[];
        return (
          <div className="flex flex-col gap-1">
            {peppolAddresses.length > 0 ? (
              peppolAddresses.map((address, index) => (
                <span key={index} className="font-mono text-xs">
                  {address}
                </span>
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
      accessorKey: "city",
      header: ({ column }) => <ColumnHeader column={column} title={t`City`} />,
      meta: { label: t`City` },
      cell: ({ row }) => {
        const city = row.getValue("city") as string;
        return city ? (
          <span>{city}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
      enableGlobalFilter: true,
    },
    {
      accessorKey: "country",
      header: ({ column }) => <ColumnHeader column={column} title={t`Country`} />,
      meta: { label: t`Country` },
      cell: ({ row }) => {
        const country = row.getValue("country") as string;
        return country ? (
          <span>{regionDisplayName(regionNames, country, country)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
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
      id: "actions",
      header: "",
      size: 100,
      cell: ({ row }) => {
        const customer = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setDialogMode("edit");
                setEditingCustomer(customer);
                setFormData({
                  id: customer.id,
                  externalId: customer.externalId,
                  name: customer.name,
                  vatNumber: customer.vatNumber,
                  enterpriseNumber: customer.enterpriseNumber,
                  peppolAddresses: customer.peppolAddresses || [],
                  address: customer.address,
                  city: customer.city,
                  postalCode: customer.postalCode,
                  country: customer.country,
                  email: customer.email,
                  phone: customer.phone,
                });
                setIsDialogOpen(true);
              }}
              title={t`Edit`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <AsyncButton
              variant="ghost-destructive"
              size="icon"
              onClick={async () => await handleDeleteCustomer(customer)}
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
    data: customers,
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
      globalFilter,
      pagination: paginationState,
    },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    pageCount: Math.ceil(total / limit),
  });

  const filterConfigs: FilterConfig<Customer>[] = [];

  return (
    <PageTemplate
      breadcrumbs={[{ label: "Peppol" }, { label: t`Customers` }]}
      description={t`View and manage your customers (supporting data).`}
      buttons={[
        <Dialog
          key="upsert-customer-dialog"
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
        >
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setDialogMode("create");
                setFormData(defaultCustomerFormData);
                setEditingCustomer(null);
              }}
            >
              {t`Create Customer`}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px]">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "create"
                  ? t`Create New Customer`
                  : t`Edit Customer`}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === "create"
                  ? t`Create a new customer with the details below.`
                  : t`Update the customer details below.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t`Name *`}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="externalId">{t`External ID`}</Label>
                  <Input
                    id="externalId"
                    value={formData.externalId || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        externalId: e.target.value || null,
                      })
                    }
                    placeholder={t`Optional external identifier`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vatNumber">{t`VAT Number`}</Label>
                  <Input
                    id="vatNumber"
                    value={formData.vatNumber || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        vatNumber: e.target.value || null,
                      })
                    }
                    placeholder="BE0123456789"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="enterpriseNumber">{t`Enterprise Number`}</Label>
                  <Input
                    id="enterpriseNumber"
                    value={formData.enterpriseNumber || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        enterpriseNumber: e.target.value || null,
                      })
                    }
                    placeholder="0123456789"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t`Email`}</Label>
                  <Input
                    id="email"
                    value={formData.email || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        email: e.target.value || null,
                      })
                    }
                    placeholder="email@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">{t`Phone`}</Label>
                  <Input
                    id="phone"
                    value={formData.phone || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        phone: e.target.value || null,
                      })
                    }
                    placeholder="887 654 321"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">{t`Address *`}</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                  placeholder={t`Main Street 123`}
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">{t`City *`}</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) =>
                      setFormData({ ...formData, city: e.target.value })
                    }
                    placeholder={t`Brussels`}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">{t`Postal Code *`}</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) =>
                      setFormData({ ...formData, postalCode: e.target.value })
                    }
                    placeholder="1000"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">{t`Country *`}</Label>
                  <Select
                    value={formData.country}
                    onValueChange={(value) =>
                      setFormData({ ...formData, country: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t`Select country`} />
                    </SelectTrigger>
                    <SelectContent>
                      {countryOptions.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.flag} {regionDisplayName(regionNames, country.code, country.name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t`Peppol IDs`}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addPeppolAddress}
                  >
                    {t`Add`}
                  </Button>
                </div>
                {formData.peppolAddresses.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t`No Peppol IDs added yet.`}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formData.peppolAddresses.map((addr, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          value={addr}
                          onChange={(e) =>
                            updatePeppolAddress(idx, e.target.value)
                          }
                          placeholder="0208:0123456789"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => removePeppolAddress(idx)}
                        >
                          {t`Remove`}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  {t`Cancel`}
                </Button>
                <AsyncButton onClick={handleUpsertCustomer}>
                  {dialogMode === "create" ? t`Create Customer` : t`Save Changes`}
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
              searchPlaceholder={t`Search customers...`}
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
