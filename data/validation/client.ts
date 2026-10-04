import {
  validationResponse,
  type ValidationProfile,
  type ValidationResponse,
} from "@peppol/types/validation";
import { sendTelegramNotification } from "@peppol/utils/system-notifications/telegram";

export async function validateXmlDocument(
  xmlDocument: string,
  options: { profile?: ValidationProfile } = {},
): Promise<ValidationResponse> {
  try {
    const url = new URL(process.env.VALIDATION_SERVICE_URL ?? "https://validation.recommand.dev/validate");
    if (options.profile) {
      url.searchParams.set("profile", options.profile);
    }
    const response = await fetch(url, {
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
    const field = error.fieldName || "root";
    const message = error.ruleCode
      ? `${error.ruleCode}: ${error.errorMessage}`
      : error.errorMessage;
    const messages = all[field] ?? [];
    if (!messages.includes(message)) {
      all[field] = [...messages, message];
    }
    return all;
  }, {});
}
