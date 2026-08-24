import { isReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/keys";

export function incrementDocumentNumber(input: string): string | null {
  const raw = typeof input === "string" ? input : "";
  const value = raw.trim();
  if (!value) return null;

  const re = /\d+/g;
  let match: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((match = re.exec(value)) !== null) {
    last = match;
  }
  if (!last) return null;

  const digits = last[0];
  const start = last.index;
  const end = start + digits.length;

  let nextDigits: string;
  try {
    const incremented = (BigInt(digits) + 1n).toString();
    nextDigits =
      incremented.length < digits.length
        ? incremented.padStart(digits.length, "0")
        : incremented;
  } catch {
    return null;
  }

  return value.slice(0, start) + nextDigits + value.slice(end);
}

export function extractLastUsedIban(parsed: unknown): string | null {
  const anyParsed = parsed as any;
  const paymentMeans = anyParsed?.paymentMeans;
  if (!Array.isArray(paymentMeans) || paymentMeans.length === 0) {
    return null;
  }

  for (let i = paymentMeans.length - 1; i >= 0; i -= 1) {
    const ibanRaw = paymentMeans[i]?.iban;
    const iban = typeof ibanRaw === "string" ? ibanRaw.trim() : "";
    if (iban) return iban;
  }
  return null;
}

export function extractDocumentNumberForType(
  parsed: unknown,
  type:
    | "invoice"
    | "creditNote"
    | "selfBillingInvoice"
    | "selfBillingCreditNote"
    | "messageLevelResponse"
    | "frenchInvoicingCdar"
    | "frenchB2CSalesReport"
    | "frenchB2CPaymentReport"
    | "frenchB2BiInvoiceReport"
    | "frenchB2BiPaymentReport"
    | "unknown"
): string | null {
  const anyParsed = parsed as any;
  if (!anyParsed || typeof anyParsed !== "object") return null;

  if (type === "invoice" || type === "selfBillingInvoice") {
    const n = anyParsed?.invoiceNumber;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  if (type === "creditNote" || type === "selfBillingCreditNote") {
    const n = anyParsed?.creditNoteNumber;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  if (type === "frenchInvoicingCdar") {
    const n = anyParsed?.invoiceId;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  if (isReportingDocumentTypeKey(type)) {
    const n = anyParsed?.reference;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  return null;
}
