import { documentFormats } from "@peppol/utils/type-repository/document-formats";
import { isFranceBillingProcessId } from "@peppol/utils/type-repository/document-formats/france-process";
import type { AccessPointProviderId } from "@peppol/data/peppol-providers";
import { SendingFailure } from "./errors";

/** The access point the French regulated flows are transmitted over. */
const FRANCE_ACCESS_POINT_PROVIDER: AccessPointProviderId = "at-shared-ap-fr";

/**
 * The doc type ids that exist only inside the French regulated regime. They are the
 * formats whose customization sits in the French namespace, taken from the registry so a
 * French format added later is covered without this guard being updated. Supporting the
 * French processes is not the test: Peppol BIS 3 billing travels over them too, and it
 * stays available to every company for the process it is normally sent over.
 */
const FRANCE_CUSTOMIZATION_NAMESPACE = "urn:peppol:france:";

const FRANCE_DOC_TYPE_IDS = new Set(
  documentFormats
    .filter((format) =>
      format.docTypeId.includes(FRANCE_CUSTOMIZATION_NAMESPACE),
    )
    .map((format) => format.docTypeId),
);

/**
 * French regulated documents are only accepted from a company registered in France whose
 * transmissions leave over the AT access point. Any other setup produces a transmission
 * the French network turns down, so refuse it here instead of letting it fail at the far
 * end. What is wrong is the company's setup rather than the document, so the message says
 * so and stays generic about why.
 *
 * A playground company is held to its country alone: it is not registered with an access
 * point, so requiring one would leave the French flows untriable.
 */
export function assertFranceRegulatedSendingSupported(options: {
  docTypeId: string;
  processId: string;
  company: { country: string; accessPointProvider: AccessPointProviderId };
  isPlayground: boolean;
}): void {
  if (isFranceRegulatedSendingSupported(options)) {
    return;
  }

  throw new SendingFailure(
    "This company is not set up for French regulated document flows. Please contact support@recommand.eu.",
    400,
  );
}

/**
 * The same test as a question rather than a demand, for choosing between document type
 * and process combinations: one the company is not set up for is not a combination a
 * document can be routed over.
 */
export function isFranceRegulatedSendingSupported(options: {
  docTypeId: string;
  processId: string;
  company: { country: string; accessPointProvider: AccessPointProviderId };
  isPlayground: boolean;
}): boolean {
  const { docTypeId, processId, company, isPlayground } = options;

  const isFranceRegulated =
    isFranceBillingProcessId(processId) || FRANCE_DOC_TYPE_IDS.has(docTypeId);
  if (!isFranceRegulated) {
    return true;
  }

  const isFrenchCompany = company.country.toUpperCase() === "FR";
  const usesFranceAccessPoint =
    isPlayground || company.accessPointProvider === FRANCE_ACCESS_POINT_PROVIDER;
  return isFrenchCompany && usesFranceAccessPoint;
}
