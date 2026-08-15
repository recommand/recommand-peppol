import type { FranceCdarBusinessProcess } from "@peppol/utils/parsing/france-cdar/schemas";
import { UserFacingError } from "@peppol/utils/util";

export const FRANCE_REGULATED_PROCESS_ID =
  "urn:peppol:france:billing:regulated";
export const FRANCE_NON_REGULATED_PROCESS_ID =
  "urn:peppol:france:billing:non-regulated";

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
