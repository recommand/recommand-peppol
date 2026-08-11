import {
  groupValidationErrors,
  validateXmlDocument,
} from "@peppol/data/validation/client";
import type { ValidationResponse } from "@peppol/types/validation";
import { SendingFailure } from "./errors";

export async function validateDocument(
  xml: string,
): Promise<ValidationResponse> {
  const validation = await validateXmlDocument(xml);
  if (validation.result !== "invalid") return validation;

  throw new SendingFailure(
    {
      root: [
        "Document validation failed. Please ensure your document complies with all requirements (e.g. EN16931, PEPPOL BIS 3.0, etc.).",
      ],
      ...groupValidationErrors(validation),
    },
    400,
  );
}
