import type { PublicTransmittedDocument } from "@peppol/data/transmitted-documents";
import { BILLING_DOCUMENT_TEMPLATE } from "@peppol/templates/billing-document";
import { FRANCE_CDAR_TEMPLATE } from "@peppol/templates/france-cdar";
import { MESSAGE_LEVEL_RESPONSE_TEMPLATE } from "@peppol/templates/message-level-response";
import { PAYMENT_MEANS } from "@peppol/utils/payment-means";
import { getUnitCodeName } from "@peppol/utils/unit-codes";
import type {
  FranceCdar,
  FranceCdarRoleCode,
  FranceCdarStatusCode,
} from "@peppol/utils/parsing/france-cdar/schemas";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import { Decimal } from "decimal.js";

type ParsedBillingDocument =
  | import("@peppol/utils/parsing/invoice/schemas").Invoice
  | import("@peppol/utils/parsing/creditnote/schemas").CreditNote
  | import("@peppol/utils/parsing/self-billing-invoice/schemas").SelfBillingInvoice
  | import("@peppol/utils/parsing/self-billing-creditnote/schemas").SelfBillingCreditNote;

type TemplateLineDiscount = {
  amount: string;
};

type TemplateLineSurcharge = TemplateLineDiscount;

type TemplateLine = {
  id?: string | null;
  name: string;
  description?: string | null;
  note?: string | null;
  quantity: string;
  unitCode: string;
  unitCodeName: string;
  netPriceAmount: string;
  vatPercentage: string;
  netAmount: string;
  discounts?: TemplateLineDiscount[];
  surcharges?: TemplateLineSurcharge[];
};

type TemplateParty = {
  name?: string | null;
  street?: string | null;
  street2?: string | null;
  postalZone?: string | null;
  city?: string | null;
  country?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  phone?: string | null;
};

type TemplateTotals = {
  taxExclusiveAmount?: string | null;
  taxInclusiveAmount?: string | null;
  vatAmount?: string | null;
  discountAmount?: string | null;
  surchargeAmount?: string | null;
  payableAmount?: string | null;
  paidAmount?: string | null;
};

type TemplatePaymentMeans = {
  paymentMethodName: string;
  reference?: string | null;
  iban: string;
  financialInstitutionBranch?: string | null;
};

type TemplateVatSubtotal = {
  taxableAmount: string;
  vatAmount: string;
  category: string;
  percentage: string;
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
  currency?: string | null;
};

type BillingTemplateData = {
  documentId: string;
  documentType: string;
  documentTypeLabel: string;
  documentNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  buyerReference?: string | null;
  note?: string | null;
  currency?: string | null;
  seller?: TemplateParty | null;
  buyer?: TemplateParty | null;
  lines: TemplateLine[];
  totals?: TemplateTotals | null;
  vatSubtotals?: TemplateVatSubtotal[] | null;
  paymentMeans?: TemplatePaymentMeans[] | null;
};

type MessageLevelResponseTemplateData = {
  documentId: string;
  documentType: string;
  documentTypeLabel: string;
  responseId: string;
  issueDate: string;
  responseCode: string;
  responseCodeLabel: string;
  envelopeId: string;
  isAccepted: boolean;
  isRejected: boolean;
  isAcknowledgement: boolean;
};

type FranceCdarTemplateData = {
  documentId: string;
  documentType: string;
  documentTypeLabel: string;
  responseId: string;
  issueDate: string;
  businessProcess: string;
  phase: string;
  phaseLabel: string;
  senderRole: string;
  senderRoleLabel: string;
  issuerLegalId?: string;
  recipientRole: string;
  recipientRoleLabel: string;
  recipientLegalId?: string;
  recipientElectronicAddress?: string;
  statusCode: string;
  statusCodeLabel: string;
  invoiceId: string;
  invoiceIssueDate?: string;
  sellerLegalId?: string;
  reasonCode?: string;
  reason?: string;
  hasReason: boolean;
  collectedAmounts?: Array<{ amount: string; vatPercent: string }>;
  hasCollectedAmounts: boolean;
  isPositive: boolean;
  isNegative: boolean;
  isWarning: boolean;
  isInfo: boolean;
};

const FRANCE_CDAR_STATUS_LABELS: Record<FranceCdarStatusCode, string> = {
  "200": "Submitted",
  "201": "Issued",
  "202": "Received",
  "203": "Made available",
  "204": "In hand",
  "205": "Approved",
  "206": "Partially approved",
  "207": "In dispute",
  "208": "Suspended",
  "209": "Completed",
  "210": "Refused",
  "211": "Payment sent",
  "212": "Payment received",
  "213": "Rejected",
  "214": "Endorsed",
  "501": "Inadmissible",
};

const FRANCE_CDAR_ROLE_LABELS: Record<FranceCdarRoleCode, string> = {
  BY: "Buyer",
  AB: "Buyer's agent or representative",
  DL: "Factor",
  SE: "Seller",
  SR: "Seller's agent",
  WK: "Platform or dematerialisation operator",
  PE: "Payee",
  PR: "Payer",
  II: "Invoicer",
  IV: "Invoicee",
  DFH: "French Public Billing Portal (PPF)",
};

const RECOMMAND_RENDER_ENDPOINT = "https://render.recommand.dev";

function reverseAmountSign(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) return trimmedValue;
  if (trimmedValue.startsWith("-")) {
    return `+${trimmedValue.slice(1)}`;
  }
  if (trimmedValue.startsWith("+")) {
    return `-${trimmedValue.slice(1)}`;
  }
  return `-${trimmedValue}`;
}

function forcePositiveAmountSign(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) return trimmedValue;
  if (trimmedValue.startsWith("-")) {
    return `+${trimmedValue.slice(1)}`;
  }
  if (trimmedValue.startsWith("+")) {
    return trimmedValue;
  }
  return `+${trimmedValue}`;
}

function getDocumentTypeLabel(type: PublicTransmittedDocument["type"]): string {
  switch (type) {
    case "invoice":
      return "Invoice";
    case "creditNote":
      return "Credit note";
    case "selfBillingInvoice":
      return "Self-billing invoice";
    case "selfBillingCreditNote":
      return "Self-billing credit note";
    case "messageLevelResponse":
      return "Message Level Response";
    case "frenchInvoicingCdar":
      return "French Invoicing CDAR";
    default:
      return "Document";
  }
}

function buildTemplateData(document: PublicTransmittedDocument): BillingTemplateData {
  const parsed = document.parsed as ParsedBillingDocument;

  const isInvoice =
    document.type === "invoice" || document.type === "selfBillingInvoice";
  const isCreditNote =
    document.type === "creditNote" ||
    document.type === "selfBillingCreditNote";

  const documentNumber =
    (isInvoice && (parsed as any)?.invoiceNumber) ||
    (isCreditNote && (parsed as any)?.creditNoteNumber) ||
    null;

  const issueDate = parsed?.issueDate ?? null;
  const dueDate = "dueDate" in parsed ? parsed.dueDate : null;
  const buyerReference = parsed?.buyerReference && parsed.buyerReference !== documentNumber ? parsed.buyerReference : null;

  const sellerRaw = (parsed as any)?.seller;
  const buyerRaw = (parsed as any)?.buyer;

  const toParty = (p: any | null | undefined): TemplateParty | null => {
    if (!p) return null;
    return {
      name: p.name ?? null,
      street: p.street ?? null,
      street2: p.street2 ?? null,
      postalZone: p.postalZone ?? null,
      city: p.city ?? null,
      country: p.country ?? null,
      vatNumber: p.vatNumber ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
    };
  };

  const linesRaw: any[] = Array.isArray((parsed as any)?.lines)
    ? (parsed as any).lines
    : [];

  const lines: TemplateLine[] = linesRaw.map((line, index) => {
    const unitCode = line.unitCode ?? "";
    return {
      id: line.id ?? null,
      name: line.name ?? "",
      description: line.description ?? null,
      note: line.note ?? null,
      quantity: String(line.quantity ?? ""),
      unitCode,
      unitCodeName: getUnitCodeName(unitCode),
      netPriceAmount: (() => {
        const price = line.netPriceAmount ?? "0";
        const baseQty = line.baseQuantity ?? "1";
        if (new Decimal(baseQty).greaterThan(1)) {
          return `${price}\u00A0/\u00A0${baseQty}\u00A0${getUnitCodeName(unitCode)}`;
        }
        return String(price);
      })(),
      vatPercentage: line.vat?.percentage
        ? String(line.vat.percentage)
        : "",
      netAmount: line.netAmount ? String(line.netAmount) : "",
      discounts: Array.isArray(line.discounts) && line.discounts.length > 0
        ? line.discounts.map((discount: any) => ({
            amount: reverseAmountSign(String(discount.amount ?? "")),
          }))
        : undefined,
      surcharges: Array.isArray(line.surcharges) && line.surcharges.length > 0
        ? line.surcharges.map((surcharge: any) => ({
            amount: forcePositiveAmountSign(String(surcharge.amount ?? "")),
          }))
        : undefined,
      // Mustache doesn't support @index, so we synthesise index+1 when building data
    };
  });

  // Inject index+1 into each line for template display
  (lines as any).forEach((line: any, index: number) => {
    line["@indexPlusOne"] = index + 1;
  });

  const totalsRaw = (parsed as any)?.totals;
  const totals: TemplateTotals | null = totalsRaw
    ? (() => {
        const taxExclusiveAmount =
          totalsRaw.taxExclusiveAmount != null
            ? String(totalsRaw.taxExclusiveAmount)
            : null;
        const taxInclusiveAmount =
          totalsRaw.taxInclusiveAmount != null
            ? String(totalsRaw.taxInclusiveAmount)
            : null;

        let vatAmount: string | null = String(parsed?.vat?.totalVatAmount ?? "");

        const payableAmountRaw =
          totalsRaw.payableAmount != null
            ? String(totalsRaw.payableAmount)
            : totalsRaw.taxInclusiveAmount != null
              ? String(totalsRaw.taxInclusiveAmount)
              : null;

        const payableAmount =
          payableAmountRaw != null &&
          taxInclusiveAmount != null &&
          payableAmountRaw !== taxInclusiveAmount
            ? payableAmountRaw
            : null;

        return {
          taxExclusiveAmount,
          taxInclusiveAmount,
          vatAmount,
          discountAmount:
            totalsRaw.discountAmount != null
              ? reverseAmountSign(String(totalsRaw.discountAmount))
              : null,
          surchargeAmount:
            totalsRaw.surchargeAmount != null
              ? forcePositiveAmountSign(String(totalsRaw.surchargeAmount))
              : null,
          payableAmount,
          paidAmount:
            totalsRaw.paidAmount != null && totalsRaw.paidAmount !== "0.00"
              ? String(totalsRaw.paidAmount)
              : null,
        };
      })()
    : null;

  const paymentMeansRaw = parsed?.paymentMeans;
  const paymentMeans: TemplatePaymentMeans[] | null = paymentMeansRaw && Array.isArray(paymentMeansRaw) && paymentMeansRaw.length > 0
    ? paymentMeansRaw.map((payment) => {
        const paymentMethod = PAYMENT_MEANS.find((pm) => pm.key === payment.paymentMethod);
        return {
          paymentMethodName: payment.name || paymentMethod?.name || payment.paymentMethod || "Payment",
          reference: payment.reference || null,
          iban: payment.iban || "",
          financialInstitutionBranch: payment.financialInstitutionBranch || null,
        };
      })
    : null;

  const currency = (parsed as any)?.currency ?? null;
  const vatSubtotalsRaw = (parsed as any)?.vat?.subtotals;
  const vatSubtotals: TemplateVatSubtotal[] | null = vatSubtotalsRaw && Array.isArray(vatSubtotalsRaw) && vatSubtotalsRaw.length > 0
    ? vatSubtotalsRaw.map((subtotal: any) => ({
        taxableAmount: String(subtotal.taxableAmount ?? ""),
        vatAmount: String(subtotal.vatAmount ?? ""),
        category: String(subtotal.category ?? ""),
        percentage: String(subtotal.percentage ?? ""),
        exemptionReasonCode: subtotal.exemptionReasonCode ?? null,
        exemptionReason: subtotal.exemptionReason ?? null,
        currency,
      }))
    : null;

  return {
    documentId: document.id,
    documentType: document.type,
    documentTypeLabel: getDocumentTypeLabel(document.type),
    documentNumber,
    issueDate,
    dueDate,
    buyerReference,
    note: (parsed as any)?.note ?? null,
    currency: (parsed as any)?.currency ?? null,
    seller: toParty(sellerRaw),
    buyer: toParty(buyerRaw),
    lines,
    totals,
    vatSubtotals,
    paymentMeans,
  };
}

function buildMessageLevelResponseTemplateData(
  document: PublicTransmittedDocument,
): MessageLevelResponseTemplateData {
  const parsed = document.parsed as MessageLevelResponse;

  if (!parsed) {
    throw new Error("Message Level Response document missing parsed data");
  }

  const getResponseCodeLabel = (code: string): string => {
    switch (code) {
      case "AB":
        return "Message Acknowledgement";
      case "AP":
        return "Accepted";
      case "RE":
        return "Rejected";
      default:
        return code;
    }
  };

  return {
    documentId: document.id,
    documentType: document.type,
    documentTypeLabel: getDocumentTypeLabel(document.type),
    responseId: parsed.id,
    issueDate: parsed.issueDate,
    responseCode: parsed.responseCode,
    responseCodeLabel: getResponseCodeLabel(parsed.responseCode),
    envelopeId: parsed.envelopeId,
    isAccepted: parsed.responseCode === "AP",
    isRejected: parsed.responseCode === "RE",
    isAcknowledgement: parsed.responseCode === "AB",
  };
}

function buildFranceCdarTemplateData(
  document: PublicTransmittedDocument,
): FranceCdarTemplateData {
  const parsed = document.parsed as FranceCdar;

  if (!parsed) {
    throw new Error("French Invoicing CDAR document missing parsed data");
  }

  const isNegative = parsed.statusCode === "210"
    || parsed.statusCode === "213"
    || parsed.statusCode === "501";
  const isWarning = parsed.statusCode === "206"
    || parsed.statusCode === "207"
    || parsed.statusCode === "208";
  const isPositive = parsed.statusCode === "205"
    || parsed.statusCode === "209"
    || parsed.statusCode === "211"
    || parsed.statusCode === "212"
    || parsed.statusCode === "214";
  const isInfo = !isNegative && !isWarning && !isPositive;

  return {
    documentId: document.id,
    documentType: document.type,
    documentTypeLabel: getDocumentTypeLabel(document.type),
    responseId: parsed.id,
    issueDate: parsed.issueDate,
    businessProcess: parsed.businessProcess,
    phase: parsed.phase,
    phaseLabel: parsed.phase === "305" ? "Transmission" : "Processing",
    senderRole: parsed.senderRole,
    senderRoleLabel: FRANCE_CDAR_ROLE_LABELS[parsed.senderRole],
    issuerLegalId: parsed.issuerLegalId,
    recipientRole: parsed.recipientRole,
    recipientRoleLabel: FRANCE_CDAR_ROLE_LABELS[parsed.recipientRole],
    recipientLegalId: parsed.recipientLegalId,
    recipientElectronicAddress: parsed.recipientElectronicAddress,
    statusCode: parsed.statusCode,
    statusCodeLabel: FRANCE_CDAR_STATUS_LABELS[parsed.statusCode] ?? parsed.statusCode,
    invoiceId: parsed.invoiceId,
    invoiceIssueDate: parsed.invoiceIssueDate,
    sellerLegalId: parsed.sellerLegalId,
    reasonCode: parsed.reasonCode,
    reason: parsed.reason,
    hasReason: Boolean(parsed.reasonCode || parsed.reason),
    collectedAmounts: parsed.collectedAmounts,
    hasCollectedAmounts: Boolean(parsed.collectedAmounts?.length),
    isPositive,
    isNegative,
    isWarning,
    isInfo,
  };
}

async function callTailwindPdfGenerator(
  templateHtml: string,
  data: BillingTemplateData | MessageLevelResponseTemplateData | FranceCdarTemplateData,
  options: { preview: boolean; pdfa?: boolean },
): Promise<string | Buffer> {
  const body = JSON.stringify({ html: templateHtml, data });
  const searchParams = new URLSearchParams();
  if (options.preview) {
    searchParams.set("preview", "true");
  }
  if (options.pdfa) {
    searchParams.set("pdfa", "true");
  }
  const query = searchParams.toString();
  const url = query
    ? `${RECOMMAND_RENDER_ENDPOINT}/?${query}`
    : RECOMMAND_RENDER_ENDPOINT;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Failed to generate document using Tailwind PDF generator");
  }

  if (options.preview) {
    return await response.text();
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function renderDocumentHtml(
  document: PublicTransmittedDocument,
): Promise<string> {
  if (document.type === "unknown") {
    throw new Error("Unknown document type");
  }
  if (document.type === "messageLevelResponse") {
    const data = buildMessageLevelResponseTemplateData(document);
    const html = await callTailwindPdfGenerator(
      MESSAGE_LEVEL_RESPONSE_TEMPLATE,
      data,
      { preview: true },
    );
    return html.toString();
  }
  if (document.type === "frenchInvoicingCdar") {
    const data = buildFranceCdarTemplateData(document);
    const html = await callTailwindPdfGenerator(
      FRANCE_CDAR_TEMPLATE,
      data,
      { preview: true },
    );
    return html.toString();
  }

  const data = buildTemplateData(document);
  const html = await callTailwindPdfGenerator(
    BILLING_DOCUMENT_TEMPLATE,
    data,
    { preview: true },
  );
  return html.toString();
}

export async function renderDocumentPdf(
  document: PublicTransmittedDocument,
  options: { pdfa?: boolean } = {},
): Promise<Buffer> {
  if (document.type === "unknown") {
    throw new Error("Unknown document type");
  }
  if (document.type === "messageLevelResponse") {
    const data = buildMessageLevelResponseTemplateData(document);
    const pdf = await callTailwindPdfGenerator(
      MESSAGE_LEVEL_RESPONSE_TEMPLATE,
      data,
      { preview: false, pdfa: options.pdfa },
    );
    return pdf as Buffer;
  }
  if (document.type === "frenchInvoicingCdar") {
    const data = buildFranceCdarTemplateData(document);
    const pdf = await callTailwindPdfGenerator(
      FRANCE_CDAR_TEMPLATE,
      data,
      { preview: false, pdfa: options.pdfa },
    );
    return pdf as Buffer;
  }

  const data = buildTemplateData(document);
  const pdf = await callTailwindPdfGenerator(
    BILLING_DOCUMENT_TEMPLATE,
    data,
    { preview: false, pdfa: options.pdfa },
  );
  return pdf as Buffer;
}
