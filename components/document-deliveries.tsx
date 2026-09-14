import { Badge } from "@core/components/ui/badge";
import { useTranslation } from "@core/hooks/use-translation";
import type { DeliveryStatus, DeliverySummary } from "@peppol/data/deliveries/model";

/**
 * Where a document stands with each recipient: one line per channel and address,
 * with what went wrong when a delivery failed.
 */
export function DocumentDeliveries({ deliveries }: { deliveries: DeliverySummary[] }) {
  const { t, language } = useTranslation();

  const statusLabels: Record<DeliveryStatus, string> = {
    pending: t`Pending`,
    delivered: t`Delivered`,
    failed: t`Failed`,
  };
  const statusVariants: Record<DeliveryStatus, "default" | "secondary" | "destructive"> = {
    pending: "secondary",
    delivered: "default",
    failed: "destructive",
  };
  const channelLabels: Record<DeliverySummary["channel"], string> = {
    peppol: t`Peppol`,
    email: t`Email`,
  };

  if (deliveries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t`No deliveries recorded for this document.`}</p>;
  }

  return (
    <ul className="space-y-3">
      {deliveries.map((delivery) => (
        <li key={delivery.id} className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{channelLabels[delivery.channel]}</span>
            <span className="break-all text-muted-foreground">{delivery.address}</span>
            <Badge variant={statusVariants[delivery.status]}>{statusLabels[delivery.status]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t`Status since ${new Date(delivery.statusChangedAt).toLocaleString(language, {
              dateStyle: "medium",
              timeStyle: "short",
            })}`}
          </p>
          {delivery.failure && (
            <div className="text-xs text-destructive">
              {delivery.failure.message && <p>{delivery.failure.message}</p>}
              {delivery.failure.providerCode && <p>{t`Error code ${delivery.failure.providerCode}.`}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
