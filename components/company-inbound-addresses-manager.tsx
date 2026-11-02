import { useCallback, useEffect, useState } from "react";
import { Copy, Inbox, Plus, Settings2, Trash2 } from "lucide-react";
import { AsyncButton } from "@core/components/async-button";
import { ConfirmDialog } from "@core/components/confirm-dialog";
import { Button } from "@core/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { Checkbox } from "@core/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@core/components/ui/popover";
import { toast } from "@core/components/ui/sonner";
import { Switch } from "@core/components/ui/switch";
import { useHasPermission } from "@core/hooks/user";
import { useTranslation } from "@core/hooks/use-translation";
import { getDocumentTypeLabel } from "@peppol/lib/client/document-type-labels";
import { type InboundAddress, jsonRequest, type Page, v2Request } from "@peppol/lib/client/intake";
import { type IntakeDocumentType, useIntakeDocumentTypes } from "@peppol/lib/client/use-intake-document-types";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";

/**
 * The email addresses that receive documents for a company: the PDF and XML attachments
 * of every email sent to one are imported for the company.
 */
export function CompanyInboundAddressesManager({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const canRead = useHasPermission(PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_READ);
  const canManage = useHasPermission(PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_MANAGE);
  const [addresses, setAddresses] = useState<InboundAddress[] | null>(null);
  const documentTypes = useIntakeDocumentTypes();
  const basePath = `/companies/${companyId}/email/inbound-addresses`;

  const load = useCallback(async () => {
    try {
      const page = await v2Request<Page<InboundAddress>>(`${basePath}?limit=100`);
      setAddresses(page.data);
    } catch (error) {
      toast.error(t`Failed to load inbound email addresses: ${error instanceof Error ? error.message : String(error)}`);
      setAddresses([]);
    }
  }, [basePath, t]);

  useEffect(() => {
    if (canRead) load();
  }, [canRead, load]);

  if (!canRead) {
    return null;
  }

  if (addresses === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t`Inbound email addresses`}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="text-center text-muted-foreground">{t`Loading...`}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      await load();
    }
  };

  const create = () => run(() => v2Request(basePath, jsonRequest("POST", {}, true)), t`Inbound email address created`);
  const update = (address: InboundAddress, changes: { enabled?: boolean; acceptedTypes?: string[] | null }) =>
    run(() => v2Request(`${basePath}/${address.id}`, jsonRequest("PATCH", changes)), t`Inbound email address updated`);
  const remove = (address: InboundAddress) =>
    run(() => v2Request(`${basePath}/${address.id}`, { method: "DELETE" }), t`Inbound email address deleted`);

  // "All supported types" is its own choice (null), which also covers types added later.
  // Leaving it lists every type explicitly, so nothing changes until a type is unchecked.
  const toggleAll = (address: InboundAddress, checked: boolean) =>
    update(address, { acceptedTypes: checked ? null : documentTypes.map((type) => type.key) });

  const toggleType = (address: InboundAddress, type: string, checked: boolean) => {
    const current = address.acceptedTypes ?? [];
    const next = checked ? [...new Set([...current, type])] : current.filter((value) => value !== type);
    if (next.length === 0) {
      toast.error(t`Accept at least one document type`);
      return;
    }
    update(address, { acceptedTypes: next });
  };

  const copy = (address: string) => {
    navigator.clipboard.writeText(address);
    toast.success(t`Email address copied to clipboard`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{t`Inbound email addresses`}</CardTitle>
            <CardDescription className="text-balance">
              {t`Forward invoices and credit notes to one of these addresses. The PDF and XML attachments are processed into incoming documents of this company.`}
            </CardDescription>
          </div>
          {canManage && (
            <AsyncButton size="sm" onClick={create}>
              <Plus className="h-4 w-4" />
              {t`Add Address`}
            </AsyncButton>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {addresses.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t`No inbound email addresses`}</p>
            {canManage && <p className="text-sm">{t`Add an address to receive documents by email`}</p>}
          </div>
        )}
        {addresses.map((address) => (
          <div key={address.id} className="flex items-center justify-between p-3 border rounded-lg gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-medium truncate">{address.address}</span>
                <Button variant="ghost" size="icon-sm" title={t`Copy`} onClick={() => copy(address.address)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
                {!address.enabled && (
                  <>
                    <span>{t`Disabled`}</span>
                    <span>•</span>
                  </>
                )}
                <span>
                  {address.acceptedTypes
                    ? address.acceptedTypes.map((type) => getDocumentTypeLabel(t, type)).join(", ")
                    : t`All supported types`}
                </span>
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={address.enabled}
                  onCheckedChange={(enabled) => update(address, { enabled })}
                  title={address.enabled ? t`Disable` : t`Enable`}
                />
                <Popover>
                  <PopoverTrigger render={<Button variant="outline" size="sm" title={t`Accepted document types`} />}>
                    <Settings2 className="h-4 w-4" />
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-2">
                    <p className="text-sm font-medium">{t`Accepted document types`}</p>
                    <label
                      htmlFor={`accepted-${address.id}-all`}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        id={`accepted-${address.id}-all`}
                        checked={address.acceptedTypes === null}
                        disabled={documentTypes.length === 0}
                        onCheckedChange={(checked) => toggleAll(address, checked === true)}
                      />
                      {t`All supported types`}
                    </label>
                    <AcceptedTypeOptions
                      address={address}
                      types={documentTypes.filter((type) => type.aiIntake)}
                      onToggle={toggleType}
                    />
                    {documentTypes.some((type) => !type.aiIntake) && (
                      <p className="text-xs text-muted-foreground pt-1">{t`XML only`}</p>
                    )}
                    <AcceptedTypeOptions
                      address={address}
                      types={documentTypes.filter((type) => !type.aiIntake)}
                      onToggle={toggleType}
                    />
                  </PopoverContent>
                </Popover>
                <ConfirmDialog
                  title={t`Delete inbound email address`}
                  description={t`Email sent to this address is refused from now on. The address cannot be used again. Documents already received stay.`}
                  confirmButtonText={t`Delete`}
                  onConfirm={() => remove(address)}
                  trigger={
                    <Button variant="destructive" size="sm" title={t`Delete`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AcceptedTypeOptions({
  address,
  types,
  onToggle,
}: {
  address: InboundAddress;
  types: IntakeDocumentType[];
  onToggle: (address: InboundAddress, type: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return types.map(({ key }) => (
    <label key={key} htmlFor={`accepted-${address.id}-${key}`} className="flex items-center gap-2 text-sm cursor-pointer pl-6">
      <Checkbox
        id={`accepted-${address.id}-${key}`}
        checked={address.acceptedTypes === null || address.acceptedTypes.includes(key)}
        disabled={address.acceptedTypes === null}
        onCheckedChange={(checked) => onToggle(address, key, checked === true)}
      />
      {getDocumentTypeLabel(t, key)}
    </label>
  ));
}
