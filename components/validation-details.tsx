import { CircleX, TriangleAlert } from "lucide-react";
import type { ValidationResponse } from "@peppol/types/validation";
import { useTranslation } from "@core/hooks/use-translation";
import { Badge } from "@core/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@core/components/ui/card";
import { getValidationStatus } from "@peppol/lib/client/validation-status";

interface ValidationDetailsProps {
  validation: ValidationResponse;
}

export function ValidationDetails({ validation }: ValidationDetailsProps) {
  const { t } = useTranslation();
  return (
    <>
      {validation.errors && validation.errors.length > 0 && (
        <>
          <div className="text-sm font-medium mb-2">{t`Errors:`}</div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {validation.errors.map((error, index) => (
              <div key={index} className="text-xs border-l-2 border-destructive pl-2 break-words">
                {error.fieldName && (
                  <div className="font-medium text-foreground mb-0.5 break-words">
                    {error.fieldName}
                  </div>
                )}
                <div className="text-muted-foreground break-words">
                  {error.errorMessage}
                </div>
                {error.ruleCode && (
                  <div className="text-muted-foreground mt-0.5 font-mono text-[10px] break-words">
                    {error.ruleCode}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {(!validation.errors || validation.errors.length === 0) && (
        <div className="text-xs text-muted-foreground">
          {t`No detailed error information available.`}
        </div>
      )}
    </>
  );
}

interface ValidationStatusProps {
  validation: ValidationResponse | null | undefined;
}

/** The validation result next to the document's title; nothing for a valid document. */
export function ValidationStatusBadge({ validation }: ValidationStatusProps) {
  const { t } = useTranslation();
  const status = getValidationStatus(t, validation);
  if (!status) return null;

  return (
    <Badge
      variant={status.kind === "invalid" ? "destructive" : "outline"}
      className="text-sm"
    >
      {status.label}
    </Badge>
  );
}

/**
 * The validation result in full. Only an invalid document gets the error treatment and
 * its findings; a document that was not checked says so without suggesting it is wrong.
 */
export function ValidationStatusCard({ validation }: ValidationStatusProps) {
  const { t } = useTranslation();
  const status = getValidationStatus(t, validation);
  if (!status || !validation) return null;

  if (status.kind === "invalid") {
    return (
      <Card className="border-destructive/30 bg-destructive/5 dark:border-destructive/50 dark:bg-destructive/10">
        <CardHeader>
          <CardTitle>{t`Document Validation Issues`}</CardTitle>
          <CardDescription className="text-foreground">
            {status.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ValidationDetails validation={validation} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{status.label}</CardTitle>
        <CardDescription>{status.description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** The icon the documents list shows for a validation result that needs a second look. */
export function ValidationStatusIcon({ validation }: ValidationStatusProps) {
  const { t } = useTranslation();
  const status = getValidationStatus(t, validation);
  if (status?.kind === "invalid") {
    return <CircleX className="h-4 w-4 text-destructive" />;
  }
  if (status?.kind === "unavailable") {
    return <TriangleAlert className="h-4 w-4 text-muted-foreground" />;
  }
  return null;
}
