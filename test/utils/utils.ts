import { expect } from "bun:test";
import { validateXmlDocument } from "../../data/validation/client";
import type { DocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
import { SKIP_E2E } from "./skip-e2e";
import { getTestHost } from "./dev-server";

export async function validateXml(xml: string, testName: string): Promise<void> {
  const validation = await validateXmlDocument(xml);
  if (validation.result !== "valid") {
    console.error(`Validation failed for ${testName}:`, validation.errors);
    console.error("XML:", xml);
  }
  expect(validation.result).toBe("valid");
  expect(validation.errors.length).toBe(0);
}



export async function sendDocumentViaAPI(
  document: unknown,
  documentType: DocumentTypeKey,
  recipientAddress: string = "0208:0598726857"
): Promise<void> {
  if (SKIP_E2E) {
    return;
  }

  // Same host the preloaded setup started the server on, so this does not go
  // looking somewhere else when ETE_UNIT_TEST_HOST is left at its default.
  const host = getTestHost();
  const companyId = process.env.ETE_UNIT_TEST_COMPANY_ID;
  const jwt = process.env.ETE_UNIT_TEST_JWT;

  if (!companyId || !jwt) {
    return;
  }

  const url = `${host}/api/peppol/${companyId}/sendDocument`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      recipient: recipientAddress,
      documentType,
      document,
    }),
  });

  expect(response.status).toBe(200);

  const responseData = await response.json();
  expect(responseData).toBeDefined();
  expect(responseData.success).toBe(true);
  expect(responseData.id).toBeDefined();
  expect(responseData.teamId).toBeDefined();
  expect(responseData.companyId).toBeDefined();
  expect(typeof responseData.sentOverPeppol).toBe("boolean");
  expect(typeof responseData.sentOverEmail).toBe("boolean");
  expect(responseData.sentOverPeppol).toBe(true);
  expect(responseData.sentOverEmail).toBe(false);
}
