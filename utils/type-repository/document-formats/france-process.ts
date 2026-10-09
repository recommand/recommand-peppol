import type { FranceCdarBusinessProcess } from "@peppol/utils/parsing/france-cdar/schemas";
import { UserFacingError } from "@peppol/utils/util";
import type { DetectionContext } from "./xml-detection";

export const FRANCE_REGULATED_PROCESS_ID =
  "urn:peppol:france:billing:regulated";
export const FRANCE_NON_REGULATED_PROCESS_ID =
  "urn:peppol:france:billing:non-regulated";

/**
 * BT-24 of a French CIUS invoice or credit note, as AFNOR XP Z12-012 prescribes it. The
 * Peppol customization ids below name the profiles in the SMP and the SBDH only (Peppol
 * France Solution Architecture 1.3.2, sections 5.2.1 and 6.2-6.3).
 */
export const FRANCE_CIUS_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017";

/** BT-24 of a French EXTENDED-CTC-FR invoice or credit note, as XP Z12-012 prescribes it. */
export const FRANCE_EXTENDED_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";

export const PEPPOL_FRANCE_CIUS_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0";
export const PEPPOL_FRANCE_EXTENDED_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#conformant#urn:peppol:france:billing:extended:1.0";

/**
 * Whether a document's BT-24 makes it French CIUS. Plain EN 16931 is also what a generic
 * EN 16931 document declares, so it counts only when the document is sent over a French
 * billing process. Documents written before the official values were settled carry the
 * Peppol customization id instead.
 */
export function isFranceCiusCustomizationId(
  customizationId: string,
  context: DetectionContext,
): boolean {
  if (customizationId === PEPPOL_FRANCE_CIUS_CUSTOMIZATION_ID) return true;
  return customizationId === FRANCE_CIUS_CUSTOMIZATION_ID
    && !!context.processId
    && isFranceBillingProcessId(context.processId);
}

/** Whether a document's BT-24 makes it French EXTENDED-CTC-FR, by the official or the Peppol id. */
export function isFranceExtendedCustomizationId(customizationId: string): boolean {
  return customizationId === FRANCE_EXTENDED_CUSTOMIZATION_ID
    || customizationId === PEPPOL_FRANCE_EXTENDED_CUSTOMIZATION_ID;
}

export type FranceBillingBusinessProcess = "REGULATED" | "NON_REGULATED";

export function isFranceBillingProcessId(processId: string): boolean {
  return processId === FRANCE_REGULATED_PROCESS_ID
    || processId === FRANCE_NON_REGULATED_PROCESS_ID;
}

export function getFranceBillingProcessId(
  businessProcess: FranceBillingBusinessProcess,
): string {
  return businessProcess === "REGULATED"
    ? FRANCE_REGULATED_PROCESS_ID
    : FRANCE_NON_REGULATED_PROCESS_ID;
}

export function getFranceCdarProcessId(
  businessProcess: FranceCdarBusinessProcess,
): string {
  return getFranceBillingProcessId(
    businessProcess === "REGULATED" ? "REGULATED" : "NON_REGULATED",
  );
}

function assertProcessId(
  processId: string,
  expectedProcessId: string,
  businessProcess: string,
): void {
  if (processId !== expectedProcessId) {
    throw new UserFacingError(
      `Process identifier '${processId}' does not match business process '${businessProcess}'. Expected '${expectedProcessId}'.`,
    );
  }
}

export function assertFranceBillingProcessId(
  processId: string,
  businessProcess: FranceBillingBusinessProcess | undefined,
): void {
  if (businessProcess) {
    assertProcessId(
      processId,
      getFranceBillingProcessId(businessProcess),
      businessProcess,
    );
  }
}

export function assertFranceCdarProcessId(
  processId: string,
  businessProcess: FranceCdarBusinessProcess,
): void {
  assertProcessId(
    processId,
    getFranceCdarProcessId(businessProcess),
    businessProcess,
  );
}
