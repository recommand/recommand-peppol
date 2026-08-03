import type { ValidationResponse } from "@peppol/types/validation";
import { useTranslation } from "@core/hooks/use-translation";

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
