import {
  validationResponse,
  type ValidationResponse,
} from "@peppol/types/validation";
import { sendTelegramNotification } from "@peppol/utils/system-notifications/telegram";

export async function validateXmlDocument(
  xmlDocument: string,
): Promise<ValidationResponse> {
  try {
    const response = await fetch("https://validation.recommand.dev/validate", {
      method: "POST",
      body: xmlDocument,
      headers: {
        "Content-Type": "application/xml",
      },
    });

    if (!response.ok) {
      console.error(`Failed to validate XML document: ${response.status}`);
      sendTelegramNotification(
        `Failed to reach validation service successfully: ${response.status}`,
      );
      return { result: "error", errors: [] };
    }

    const data = await response.json();
    const parsed = validationResponse.safeParse(data);

    if (!parsed.success) {
      console.error(
        `Failed to parse validation response: ${JSON.stringify(parsed.error)}`,
      );
      sendTelegramNotification(
        `Failed to parse validation response: ${JSON.stringify(parsed.error)}`,
      );
      return { result: "error", errors: [] };
    }

    return parsed.data;
  } catch (error) {
    console.error("Failed to validate XML document:", error);
    sendTelegramNotification(`Failed to validate XML document: ${error}`);
    return { result: "error", errors: [] };
  }
}

export function groupValidationErrors(
  validation: ValidationResponse,
): Record<string, string[]> {
  return validation.errors.reduce<Record<string, string[]>>((all, error) => {
    const message = `${error.ruleCode}: ${error.errorMessage}`;
    const messages = all[error.fieldName] ?? [];
    if (!messages.includes(message)) {
      all[error.fieldName] = [...messages, message];
    }
    return all;
  }, {});
}
