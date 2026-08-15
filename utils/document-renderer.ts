import type { PublicTransmittedDocument } from "@peppol/data/transmitted-documents";
import { BILLING_DOCUMENT_TEMPLATE } from "@peppol/templates/billing-document";
import { FRANCE_CDAR_TEMPLATE } from "@peppol/templates/france-cdar";
import { MESSAGE_LEVEL_RESPONSE_TEMPLATE } from "@peppol/templates/message-level-response";
import { PAYMENT_MEANS } from "@peppol/utils/payment-means";
import { getUnitCodeName } from "@peppol/utils/unit-codes";
import type {
  FranceCdar,
  FranceCdarCollectedAmount,
  FranceCdarRoleCode,
  FranceCdarStatusCode,
} from "@peppol/utils/parsing/france-cdar/schemas";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import type { FrenchB2CReport } from "@peppol/utils/parsing/b2c-reporting/france";
import type { StoredDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { FRANCE_B2C_REPORT_TEMPLATE } from "@peppol/templates/france-b2c-report";
import { renderTailwindTemplate } from "@peppol/utils/tailwind-pdf";
import { Decimal } from "decimal.js";

export type ParsedBillingDocument =
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
  issuerRole: string;
  issuerRoleLabel: string;
  issuerLegalId?: string;
  issuerLegalIdScheme?: string;
  recipientRole: string;
  recipientRoleLabel: string;
  recipientLegalId?: string;
  recipientLegalIdScheme?: string;
  recipientElectronicAddress?: string;
  recipientElectronicAddressScheme?: string;
  statusCode: string;
  statusCodeLabel: string;
  invoiceId: string;
  invoiceIssueDate?: string;
  sellerLegalId?: string;
  sellerLegalIdScheme?: string;
  reasonCode?: string;
  reason?: string;
  reasonNote?: string;
  hasReason: boolean;
  collectedAmounts?: FranceCdarCollectedAmount[];
  hasCollectedAmounts: boolean;
  isPositive: boolean;
  isNegative: boolean;
  isWarning: boolean;
  isInfo: boolean;
};

type FranceB2CReportVatSubtotal = {
  percentage: string;
  taxableAmount?: string;
  taxAmount?: string;
  amount?: string;
  currency?: string;
};

type FranceB2CReportTemplateData = {
  documentId: string;
  documentType: string;
  documentTypeLabel: string;
  reference: string;
  reportTypeLabel: string;
  dateLabel: string;
  date: string;
  actionLabel: string;
  isSubmission: boolean;
  isCorrection: boolean;
  isCancellation: boolean;
  isSales: boolean;
  isPayments: boolean;
  currency: string;
  categoryLabel?: string;
  transactionCount?: number;
  taxExclusiveAmount?: string;
  taxAmount?: string;
  salesVatBreakdown: FranceB2CReportVatSubtotal[];
  paymentVatBreakdown: FranceB2CReportVatSubtotal[];
};

const FRANCE_B2C_REPORT_ACTION_LABELS: Record<FrenchB2CReport["action"], string> = {
  submit: "Submission",
  correct: "Correction",
  cancel: "Cancellation",
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
  DFH: "French public invoicing portal (PPF)",
  PE: "Payee",
  PR: "Payer",
  II: "Invoicer",
  IV: "Invoicee",
};

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

/**
 * Everything a layout needs beyond the parsed document itself. Every builder below
 * takes one of these rather than a stored row, so callers that hold a parsed
 * document (the type repository) can render without inventing a row.
 */
type DocumentRenderContext = {
  documentId: string;
  type: PublicTransmittedDocument["type"];
  documentTypeTitle: string;
};

function buildTemplateData(
  parsed: ParsedBillingDocument,
  context: DocumentRenderContext,
): BillingTemplateData {
  const isInvoice =
    context.type === "invoice" || context.type === "selfBillingInvoice";
  const isCreditNote =
    context.type === "creditNote" ||
    context.type === "selfBillingCreditNote";

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
    documentId: context.documentId,
    documentType: context.type,
    documentTypeLabel: context.documentTypeTitle,
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
  parsed: MessageLevelResponse,
  context: DocumentRenderContext,
): MessageLevelResponseTemplateData {
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
    documentId: context.documentId,
    documentType: context.type,
    documentTypeLabel: context.documentTypeTitle,
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
  parsed: FranceCdar,
  context: DocumentRenderContext,
): FranceCdarTemplateData {
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
    documentId: context.documentId,
    documentType: context.type,
    documentTypeLabel: context.documentTypeTitle,
    responseId: parsed.id,
    issueDate: parsed.issueDate,
    businessProcess: parsed.businessProcess,
    phase: parsed.phase,
    phaseLabel: parsed.phase === "305" ? "Transmission" : "Processing",
    senderRole: parsed.senderRole,
    senderRoleLabel: FRANCE_CDAR_ROLE_LABELS[parsed.senderRole],
    issuerRole: parsed.issuerRole,
    issuerRoleLabel: FRANCE_CDAR_ROLE_LABELS[parsed.issuerRole],
    issuerLegalId: parsed.issuerLegalId,
    issuerLegalIdScheme: parsed.issuerLegalIdScheme,
    recipientRole: parsed.recipientRole,
    recipientRoleLabel: FRANCE_CDAR_ROLE_LABELS[parsed.recipientRole],
    recipientLegalId: parsed.recipientLegalId,
    recipientLegalIdScheme: parsed.recipientLegalIdScheme,
    recipientElectronicAddress: parsed.recipientElectronicAddress,
    recipientElectronicAddressScheme:
      parsed.recipientElectronicAddressScheme,
    statusCode: parsed.statusCode,
    statusCodeLabel: FRANCE_CDAR_STATUS_LABELS[parsed.statusCode] ?? parsed.statusCode,
    invoiceId: parsed.invoiceId,
    invoiceIssueDate: parsed.invoiceIssueDate,
    sellerLegalId: parsed.sellerLegalId,
    sellerLegalIdScheme: parsed.sellerLegalIdScheme,
    reasonCode: parsed.reasonCode,
    reason: parsed.reason,
    reasonNote: parsed.reasonNote,
    hasReason: Boolean(parsed.reasonCode || parsed.reason || parsed.reasonNote),
    collectedAmounts: parsed.collectedAmounts,
    hasCollectedAmounts: Boolean(parsed.collectedAmounts?.length),
    isPositive,
    isNegative,
    isWarning,
    isInfo,
  };
}

export function buildFranceB2CReportTemplateData(
  parsed: FrenchB2CReport,
  context: DocumentRenderContext,
): FranceB2CReportTemplateData {
  const isSales = parsed.type === "sales";
  const currency = isSales ? parsed.currency : "EUR";

  return {
    documentId: context.documentId,
    documentType: context.type,
    documentTypeLabel: context.documentTypeTitle,
    reference: parsed.reference,
    reportTypeLabel: isSales ? "Daily sales" : "Daily payments received",
    dateLabel: isSales ? "Sales date" : "Payment date",
    date: parsed.date,
    actionLabel: FRANCE_B2C_REPORT_ACTION_LABELS[parsed.action],
    isSubmission: parsed.action === "submit",
    isCorrection: parsed.action === "correct",
    isCancellation: parsed.action === "cancel",
    isSales,
    isPayments: !isSales,
    currency,
    categoryLabel: isSales
      ? parsed.category === "goods"
        ? "Taxable goods"
        : "Taxable services"
      : undefined,
    transactionCount: isSales ? parsed.transactionCount : undefined,
    taxExclusiveAmount: isSales ? parsed.taxExclusiveAmount : undefined,
    taxAmount: isSales ? parsed.taxAmount : undefined,
    // The template renders one table per report type, so each breakdown is only
    // populated for the type it belongs to.
    salesVatBreakdown: isSales
      ? parsed.vatBreakdown.map((subtotal) => ({ ...subtotal, currency }))
      : [],
    paymentVatBreakdown: isSales ? [] : parsed.vatBreakdown,
  };
}

/**
 * Whether a document has a layout to render to HTML or PDF. Callers that render
 * opportunistically (notification attachments, exports) should check this first.
 */
export function isRenderableDocumentType(type: StoredDocumentType): boolean {
  return type !== "unknown";
}

/**
 * Renders a billing document straight from its parsed form, for callers that
 * hold a document rather than a stored row (the type repository). The
 * transmitted-document entry points below wrap this.
 */
export async function renderBillingDocument<F extends "html" | "pdf">(
  parsed: ParsedBillingDocument,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
): Promise<F extends "pdf" ? Buffer : string> {
  return renderTemplate(
    BILLING_DOCUMENT_TEMPLATE,
    buildTemplateData(parsed, context),
    options,
  );
}

/**
 * Renders a Message Level Response from its parsed form. The counterpart of
 * renderBillingDocument for the MLR layout.
 */
export async function renderMessageLevelResponse<F extends "html" | "pdf">(
  parsed: MessageLevelResponse,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
): Promise<F extends "pdf" ? Buffer : string> {
  return renderTemplate(
    MESSAGE_LEVEL_RESPONSE_TEMPLATE,
    buildMessageLevelResponseTemplateData(parsed, context),
    options,
  );
}

/** Renders a French Invoicing CDAR from its parsed form. */
export async function renderFranceCdar<F extends "html" | "pdf">(
  parsed: FranceCdar,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
): Promise<F extends "pdf" ? Buffer : string> {
  return renderTemplate(
    FRANCE_CDAR_TEMPLATE,
    buildFranceCdarTemplateData(parsed, context),
    options,
  );
}

/**
 * Renders a French B2C sales or payment report from its parsed form. The report
 * type comes from the document itself; `context.type` only picks the heading.
 */
export async function renderFranceB2CReport<F extends "html" | "pdf">(
  parsed: FrenchB2CReport,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
): Promise<F extends "pdf" ? Buffer : string> {
  return renderTemplate(
    FRANCE_B2C_REPORT_TEMPLATE,
    buildFranceB2CReportTemplateData(parsed, context),
    options,
  );
}

/**
 * The one place the format option is turned into renderTailwindTemplate's flags,
 * so every layout treats `pdfa` and the preview flag identically.
 */
async function renderTemplate<F extends "html" | "pdf">(
  template: string,
  data: object,
  options: { format: F; pdfa?: boolean },
): Promise<F extends "pdf" ? Buffer : string> {
  const isPdf = options.format === "pdf";
  const rendered = await renderTailwindTemplate(template, data, {
    preview: !isPdf,
    pdfa: isPdf ? options.pdfa : undefined,
  });
  return (isPdf ? rendered : rendered.toString()) as F extends "pdf"
    ? Buffer
    : string;
}

/**
 * Renders a stored row by unwrapping it into the parsed-form renderer its type
 * belongs to. The layout selection lives here only; every layout is reachable
 * without a row through the exported functions above.
 */
async function renderStoredDocument<F extends "html" | "pdf">(
  document: PublicTransmittedDocument,
  options: { format: F; pdfa?: boolean },
): Promise<F extends "pdf" ? Buffer : string> {
  const { getDocumentType } = await import(
    "@peppol/utils/type-repository/document-types"
  );
  const documentType = getDocumentType(document.type);
  if (!documentType) {
    throw new Error(`Document type ${document.type} cannot be rendered`);
  }
  if (!document.parsed && documentType.class !== "billing") {
    const label = documentType.class === "reporting"
      ? "French B2C report"
      : documentType.translatableTitle;
    throw new Error(`${label} document missing parsed data`);
  }
  return documentType.render(document.parsed as never, options, {
    documentId: document.id,
  });
}

export async function renderDocumentHtml(
  document: PublicTransmittedDocument,
): Promise<string> {
  return renderStoredDocument(document, { format: "html" });
}

export async function renderDocumentPdf(
  document: PublicTransmittedDocument,
  options: { pdfa?: boolean } = {},
): Promise<Buffer> {
  return renderStoredDocument(document, {
    format: "pdf",
    pdfa: options.pdfa,
  });
}
