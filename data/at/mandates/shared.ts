import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Arratech is the platform the company mandates towards the authorities;
 * Recommand is the operator the company contracted with. Every mandate
 * document names both, so they live outside of any one of them.
 */
export const MANDATARY = {
  legalName: "Arratech AB",
  shortName: "Arratech",
  role: "Peppol access point and service metadata publisher",
};

export const OPERATOR = {
  name: "Recommand",
  role: "e-invoicing operator",
};

/** Each document writes dates in the time zone and format of its jurisdiction. */
export function formatMandateDate(
  date: Date,
  timeZone: string,
  pattern: string,
): string {
  return format(TZDate.tz(timeZone, date), pattern);
}
