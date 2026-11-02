import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";

export type PairingXml = { documentType: AnyDocumentType; document: unknown };
export type PairingPdf = { sha256: string; text: string };

type BillingFields = {
  issueDate?: string | null;
  seller?: { vatNumber?: string | null } | null;
  totals?: { payableAmount?: string | null; taxInclusiveAmount?: string | null } | null;
  attachments?: { mimeCode?: string | null; embeddedDocument?: string | null }[] | null;
};

const compact = (value: string) => value.normalize("NFC").replace(/\s+/g, "").toLowerCase();
const alphanumeric = (value: string) => value.replace(/[^0-9a-z]/gi, "").toUpperCase();

// Month names in English, Dutch, French and German, and the English abbreviations, by month.
const MONTH_NAMES = [
  ["january", "jan", "januari", "janvier", "januar"],
  ["february", "feb", "februari", "février", "februar"],
  ["march", "mar", "maart", "mars", "märz"],
  ["april", "apr", "avril"],
  ["may", "mei", "mai"],
  ["june", "jun", "juni", "juin"],
  ["july", "jul", "juli", "juillet"],
  ["august", "aug", "augustus", "août"],
  ["september", "sep", "sept", "septembre"],
  ["october", "oct", "oktober", "octobre"],
  ["november", "nov", "novembre"],
  ["december", "dec", "décembre", "dezember"],
];

/** The ways a date is commonly printed, without spaces and in lower case. */
function dateVariants(isoDate: string): string[] {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [isoDate];
  const [, year, month, day] = match;
  const days = [day, String(Number(day))];
  const months = [month, String(Number(month))];
  const names = MONTH_NAMES[Number(month) - 1] ?? [];
  return [
    isoDate,
    ...days.flatMap((d) => months.flatMap((m) => ["/", ".", "-"].flatMap((sep) => [`${d}${sep}${m}${sep}${year}`, `${m}${sep}${d}${sep}${year}`]))),
    ...days.flatMap((d) => names.flatMap((name) => [`${d}${name}${year}`, `${d}.${name}${year}`, `${name}${d},${year}`])),
  ];
}

/** The ways an amount is commonly printed, without spaces. */
function amountVariants(amount: string): string[] {
  let value: Decimal;
  try {
    value = new Decimal(amount).abs();
  } catch {
    return [];
  }
  const [integer, fraction] = value.toFixed(2).split(".");
  const grouped = (separator: string) => integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return [
    `${integer}.${fraction}`,
    `${integer},${fraction}`,
    `${grouped(",")}.${fraction}`,
    `${grouped(".")},${fraction}`,
    `${grouped("'")}.${fraction}`,
  ];
}

function pdfHashesEmbeddedIn(document: BillingFields): string[] {
  return (document.attachments ?? [])
    .filter((attachment) => attachment.embeddedDocument && (attachment.mimeCode ?? "").toLowerCase() === "application/pdf")
    .map((attachment) => createHash("sha256").update(Buffer.from(attachment.embeddedDocument!, "base64")).digest("hex"));
}

/**
 * Whether a PDF is proven to show the same business message as a parsed XML file. A
 * filename or a document number alone is no proof. The proof is that the XML embeds
 * exactly these PDF bytes, or that the PDF's text shows the XML's document number,
 * issue date, payable amount and seller VAT number together.
 */
export function isSameMessage(xml: PairingXml, pdf: PairingPdf): boolean {
  const document = (xml.document ?? {}) as BillingFields;
  if (pdfHashesEmbeddedIn(document).includes(pdf.sha256)) {
    return true;
  }
  const number = xml.documentType.extractDocumentNumber(xml.document);
  const issueDate = document.issueDate;
  const payable = document.totals?.payableAmount ?? document.totals?.taxInclusiveAmount;
  const vatNumber = document.seller?.vatNumber;
  if (!number || !issueDate || !payable || !vatNumber || !pdf.text) {
    return false;
  }
  const text = compact(pdf.text);
  return (
    text.includes(compact(number)) &&
    dateVariants(issueDate).some((variant) => text.includes(variant)) &&
    amountVariants(String(payable)).some((variant) => text.includes(variant)) &&
    alphanumeric(pdf.text).includes(alphanumeric(vatNumber))
  );
}
