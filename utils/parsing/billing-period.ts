import { UserFacingError } from "@peppol/utils/util";
import { getNullableTextContent } from "./xml-helpers";
import type { DocumentLine, Period } from "./invoice/schemas";

// PEPPOL-EN16931-R110 and R111: a line period must fall within the invoice period.
export function assertLinePeriodsWithinBillingPeriod(document: {
  billingPeriod?: Period | null;
  lines: DocumentLine[];
}) {
  const billingPeriod = document.billingPeriod;
  if (!billingPeriod) return;

  document.lines.forEach((line, index) => {
    const linePeriod = line.billingPeriod;
    if (!linePeriod) return;
    const lineLabel = line.id || (index + 1).toString();

    if (
      linePeriod.startDate &&
      billingPeriod.startDate &&
      linePeriod.startDate < billingPeriod.startDate
    ) {
      throw new UserFacingError(
        `The billing period of line ${lineLabel} starts before the billing period of the document.`
      );
    }
    if (
      linePeriod.endDate &&
      billingPeriod.endDate &&
      linePeriod.endDate > billingPeriod.endDate
    ) {
      throw new UserFacingError(
        `The billing period of line ${lineLabel} ends after the billing period of the document.`
      );
    }
  });
}

export function billingPeriodToUBL(period: Period | null | undefined) {
  if (!period?.startDate && !period?.endDate) return {};
  return {
    "cac:InvoicePeriod": {
      ...(period.startDate && { "cbc:StartDate": period.startDate }),
      ...(period.endDate && { "cbc:EndDate": period.endDate }),
    },
  };
}

function firstNode(value: any): any {
  return Array.isArray(value) ? value[0] : value;
}

export function parseUblBillingPeriod(value: any): Period | undefined {
  const period = firstNode(value);
  const startDate = getNullableTextContent(period?.StartDate);
  const endDate = getNullableTextContent(period?.EndDate);
  if (!startDate && !endDate) return undefined;
  return { startDate, endDate };
}
