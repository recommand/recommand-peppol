import type { TranslationFunction } from "@core/lib/translations";
import type { ValidationResponse } from "@peppol/types/validation";

/**
 * How a stored validation result is shown. Only `invalid` means the document broke a
 * rule. `not_supported` means no rule set exists for its document type, so nothing was
 * checked, and `error` means the validation service could not be reached: neither says
 * anything about the document itself.
 */
export type ValidationStatus = {
  kind: "invalid" | "notValidated" | "unavailable";
  label: string;
  description: string;
};

/** Null for a valid document, and for one that was never validated at all. */
export function getValidationStatus(
  t: TranslationFunction,
  validation: ValidationResponse | null | undefined,
): ValidationStatus | null {
  switch (validation?.result) {
    case "invalid":
      return {
        kind: "invalid",
        label: t("Invalid"),
        description: t("This document has validation errors that need attention."),
      };
    case "not_supported":
      return {
        kind: "notValidated",
        label: t("Not validated"),
        description: t("No validation rules are available for this document type, so its content was not checked."),
      };
    case "error":
      return {
        kind: "unavailable",
        label: t("Validation unavailable"),
        description: t("The validation service could not be reached when this document was processed, so its content was not checked. This does not mean the document is wrong."),
      };
    default:
      return null;
  }
}
