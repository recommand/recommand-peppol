import { Badge } from "@core/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";
import type { DeliverySummary } from "@peppol/data/deliveries/model";

type DeliveryFailedBadgeProps = {
  deliveries: DeliverySummary[] | null | undefined;
  size?: "sm" | "md";
};

/**
 * Marks a document one of whose deliveries failed. The transmission icons next to it
 * still say the document was handed to Peppol or mailed, which it was; this says it
 * did not arrive somewhere. A pending delivery shows nothing: most are confirmed
 * within minutes and a badge for them would only be noise.
 */
export function DeliveryFailedBadge({ deliveries, size = "md" }: DeliveryFailedBadgeProps) {
  const { t } = useTranslation();
  const failed = (deliveries ?? []).filter((delivery) => delivery.status === "failed");
  if (failed.length === 0) {
    return null;
  }

  const details = failed.map((delivery) => {
    const parts = [
      delivery.channel === "peppol"
        ? t`Peppol delivery to ${delivery.address} failed.`
        : t`Email delivery to ${delivery.address} failed.`,
    ];
    if (delivery.failure?.message) {
      parts.push(delivery.failure.message);
    }
    if (delivery.failure?.providerCode) {
      parts.push(t`Error code ${delivery.failure.providerCode}.`);
    }
    return { id: delivery.id, text: parts.join(" ") };
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="destructive" className={size === "sm" ? "text-xs" : undefined}>
          {t`Delivery failed`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="max-w-sm space-y-1 text-xs">
          {details.map((detail) => (
            <p key={detail.id}>{detail.text}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
