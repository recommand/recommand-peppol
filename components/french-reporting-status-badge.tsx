import { Badge } from "@core/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@core/components/ui/tooltip";
import { useTranslation } from "@core/hooks/use-translation";

export type FrenchReportingStatusValue =
  | "accepted"
  | "pending_rectificative"
  | "filed"
  | "filed_rectificative"
  | "superseded"
  | "rejected";

type FrenchReportingStatusBadgeProps = {
  reporting: {
    reportingStatus: FrenchReportingStatusValue;
    final?: boolean;
    periodEnd: string | null;
    outcomeCode: string | null;
    checkedAt: string | null;
    simulated: boolean;
  } | null | undefined;
  size?: "sm" | "md";
};

/**
 * Where a filed report stands with the tax administration. A report is accepted
 * long before it is filed, and filed before the tax administration has answered,
 * so the badge tells those apart instead of showing a single "sent".
 */
export function FrenchReportingStatusBadge({ reporting, size = "md" }: FrenchReportingStatusBadgeProps) {
  const { t } = useTranslation();
  if (!reporting) {
    return null;
  }

  const labels: Record<FrenchReportingStatusValue, string> = {
    accepted: t`Accepted, awaiting filing`,
    pending_rectificative: t`Late, awaiting corrective filing`,
    filed: t`Filed`,
    filed_rectificative: t`Filed by corrective filing`,
    superseded: t`Superseded`,
    rejected: t`Rejected`,
  };
  const variants: Record<FrenchReportingStatusValue, "default" | "secondary" | "destructive" | "outline"> = {
    accepted: "secondary",
    pending_rectificative: "outline",
    filed: "default",
    filed_rectificative: "default",
    superseded: "outline",
    rejected: "destructive",
  };

  const filed =
    reporting.reportingStatus === "filed" || reporting.reportingStatus === "filed_rectificative";
  const awaitingOutcome = filed && !reporting.simulated && reporting.final === false;

  const details: string[] = [];
  if (reporting.simulated) {
    details.push(t`Simulated: this report is recorded but not filed.`);
  }
  if (reporting.periodEnd) {
    details.push(t`Reporting period ends ${reporting.periodEnd}.`);
  }
  if (reporting.outcomeCode) {
    details.push(t`Outcome code ${reporting.outcomeCode}.`);
  }
  if (awaitingOutcome) {
    details.push(t`The tax administration has not accepted the filing yet; the report is final once its outcome code is 300.`);
  }
  if (reporting.checkedAt) {
    details.push(t`Last checked ${new Date(reporting.checkedAt).toLocaleString()}.`);
  }

  const badge = (
    <Badge variant={variants[reporting.reportingStatus]} className={size === "sm" ? "text-xs" : undefined}>
      {reporting.simulated
        ? t`Simulated`
        : awaitingOutcome
          ? t`Filed, awaiting outcome`
          : labels[reporting.reportingStatus]}
    </Badge>
  );

  if (details.length === 0) {
    return badge;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          {details.map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
