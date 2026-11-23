import { OPERATIONAL_DOCUMENT_TEMPLATE } from "@peppol/templates/operational-document";
import {
  renderTemplate,
  type DocumentRenderContext,
} from "@peppol/utils/document-renderer";
import { getUnitCodeName } from "@peppol/utils/unit-codes";
import type { PartyIdentifier, Period } from "@peppol/utils/parsing/invoice/schemas";
import type { Order } from "@peppol/utils/parsing/order/schemas";
import type { OrderResponse } from "@peppol/utils/parsing/order-response/schemas";
import type { DespatchAdvice } from "@peppol/utils/parsing/despatch-advice/schemas";
import { ORDER_LINE_STATUSES } from "@peppol/utils/order-line-statuses";
import { ORDER_RESPONSES } from "@peppol/utils/order-responses";
import { ORDER_TYPES } from "@peppol/utils/order-types";
import { TRANSPORT_MODES } from "@peppol/utils/transport-modes";

type Row = { label: string; value: string };

type OperationalTemplateData = {
  documentId: string;
  documentTypeLabel: string;
  documentNumber: string;
  status: { label: string; isPositive: boolean; isNegative: boolean; isNeutral: boolean } | null;
  meta: Row[];
  note: string | null;
  parties: { role: string; name: string; lines: string[]; details: string[] }[];
  sections: { title: string; rows: Row[] }[];
  columns: string[];
  lines: { id: string; name: string; details: string[]; cells: string[] }[];
  totals: (Row & { emphasis: boolean })[];
};

type AddressedParty = {
  name?: string | null;
  street?: string | null;
  street2?: string | null;
  postalZone?: string | null;
  city?: string | null;
  country?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  enterpriseNumberScheme?: string | null;
  partyIdentifiers?: PartyIdentifier[] | null;
  email?: string | null;
  phone?: string | null;
};

function present<T>(values: (T | null | undefined | false | "")[]): T[] {
  return values.filter((value): value is T => Boolean(value));
}

function rows(entries: [string, string | null | undefined][]): Row[] {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }));
}

function nameOf(list: readonly { key: string; name: string }[], key: string): string {
  return list.find((entry) => entry.key === key)?.name ?? key;
}

function formatPeriod(period: Period | null | undefined): string | null {
  if (!period || (!period.startDate && !period.endDate)) return null;
  if (!period.endDate) return `from ${period.startDate}`;
  if (!period.startDate) return `by ${period.endDate}`;
  if (period.startDate === period.endDate) return period.startDate;
  return `${period.startDate} – ${period.endDate}`;
}

function formatIdentifier(value: PartyIdentifier | null | undefined): string | null {
  if (!value) return null;
  return value.scheme ? `${value.scheme}:${value.identifier}` : value.identifier;
}

function formatQuantity(quantity: string | null | undefined, unitCode: string | null | undefined) {
  if (!quantity) return "";
  return `${quantity} ${getUnitCodeName(unitCode || "C62")}`;
}

function party(role: string, value: AddressedParty) {
  return {
    role,
    name: value.name || "-",
    lines: present([
      value.street,
      value.street2,
      [value.postalZone, value.city].filter(Boolean).join(" "),
      value.country,
    ]),
    details: present([
      value.vatNumber && `VAT ${value.vatNumber}`,
      value.enterpriseNumber &&
        formatIdentifier({
          identifier: value.enterpriseNumber,
          scheme: value.enterpriseNumberScheme,
        }),
      ...(value.partyIdentifiers ?? []).map(formatIdentifier),
      value.email,
      value.phone,
    ]),
  };
}

function itemDetails(item: {
  description?: string | null;
  note?: string | null;
  sellersId?: string | null;
  buyersId?: string | null;
  standardId?: PartyIdentifier | null;
}) {
  return present([
    item.description,
    item.note,
    item.sellersId && `Seller's item: ${item.sellersId}`,
    item.buyersId && `Buyer's item: ${item.buyersId}`,
    item.standardId && `Item: ${formatIdentifier(item.standardId)}`,
  ]);
}

function money(value: string | null | undefined, currency: string) {
  return value ? `${value} ${currency}` : null;
}

function base(context: DocumentRenderContext, documentNumber: string) {
  return {
    documentId: context.documentId,
    documentTypeLabel: context.documentTypeTitle,
    documentNumber: documentNumber || context.documentId,
  };
}

export function buildOrderTemplateData(
  order: Order,
  context: DocumentRenderContext,
): OperationalTemplateData {
  const currency = order.currency;
  const orderType =
    order.orderType && order.orderType !== "order" ? nameOf(ORDER_TYPES, order.orderType) : null;
  const totals = order.totals;
  const delivery = order.delivery;
  return {
    ...base(context, order.orderNumber),
    status: null,
    meta: rows([
      ["Issue date", order.issueDate],
      ["Order type", orderType],
      ["Valid until", order.validityEndDate],
      ["Buyer reference", order.buyerReference],
      ["Quotation", order.quotationReference],
      ["Sales order", order.salesOrderReference],
      ["Contract", order.contractReference],
      ["Project", order.projectReference],
    ]),
    note: order.note ?? null,
    parties: [
      party("Buyer", order.buyer),
      party("Seller", order.seller),
      ...(order.invoicee ? [party("Invoicee", order.invoicee)] : []),
    ],
    sections: present([
      delivery && {
        title: "Delivery",
        rows: rows([
          ["Requested", formatPeriod(delivery.requestedPeriod)],
          ["Deliver to", delivery.recipientName],
          [
            "Address",
            delivery.location &&
              present([
                delivery.location.street,
                delivery.location.street2,
                [delivery.location.postalZone, delivery.location.city].filter(Boolean).join(" "),
                delivery.location.country,
              ]).join(", "),
          ],
          ["Location", formatIdentifier(delivery.locationIdentifier)],
        ]),
      },
      (order.deliveryTerms || order.paymentTerms) && {
        title: "Terms",
        rows: rows([
          ["Delivery terms", order.deliveryTerms?.code],
          ["Delivery terms location", order.deliveryTerms?.location],
          ["Delivery conditions", order.deliveryTerms?.specialTerms],
          ["Payment terms", order.paymentTerms?.note],
        ]),
      },
    ]),
    columns: ["Qty", "Unit price", "VAT %", "Line total"],
    lines: order.lines.map((line, index) => ({
      id: line.id || String(index + 1),
      name: line.name,
      details: present([
        ...itemDetails(line),
        formatPeriod(line.requestedDeliveryPeriod) &&
          `Requested delivery: ${formatPeriod(line.requestedDeliveryPeriod)}`,
        line.partialDeliveryAllowed === false && "No partial delivery",
        ...(line.discounts ?? []).map((discount) => `Discount: -${discount.amount} ${currency}`),
        ...(line.surcharges ?? []).map((surcharge) => `Surcharge: +${surcharge.amount} ${currency}`),
      ]),
      cells: [
        formatQuantity(line.quantity, line.unitCode),
        line.netPriceAmount ?? "",
        line.vat && line.vat.category !== "O" ? line.vat.percentage : "",
        line.netAmount ?? "",
      ],
    })),
    totals: totals
      ? [
          ...rows([
            ["Lines", money(totals.linesAmount, currency)],
            ["Discount", totals.discountAmount ? `-${totals.discountAmount} ${currency}` : null],
            ["Surcharge", totals.surchargeAmount ? `+${totals.surchargeAmount} ${currency}` : null],
            ["Total (excl. VAT)", money(totals.taxExclusiveAmount, currency)],
            ["VAT", money(order.vat?.totalVatAmount, currency)],
            ["Total (incl. VAT)", money(totals.taxInclusiveAmount, currency)],
            ["Paid in advance", money(totals.paidAmount, currency)],
          ]).map((row) => ({ ...row, emphasis: false })),
          ...rows([["Expected amount", money(totals.payableAmount, currency)]]).map((row) => ({
            ...row,
            emphasis: true,
          })),
        ]
      : [],
  };
}

export function buildOrderResponseTemplateData(
  response: OrderResponse,
  context: DocumentRenderContext,
): OperationalTemplateData {
  const answer = response.response;
  return {
    ...base(context, response.orderResponseNumber),
    status: {
      label: nameOf(ORDER_RESPONSES, answer),
      isPositive: answer === "accepted",
      isNegative: answer === "rejected",
      isNeutral: answer === "acknowledged" || answer === "conditionally_accepted",
    },
    meta: rows([
      ["Issue date", response.issueDate],
      ["Order", response.orderReference],
      ["Sales order", response.salesOrderReference],
      ["Buyer reference", response.buyerReference],
      ["Promised delivery", formatPeriod(response.promisedDeliveryPeriod)],
    ]),
    note: response.note ?? null,
    parties: [party("Seller", response.seller), party("Buyer", response.buyer)],
    sections: [],
    columns: ["Status", "Qty", "Unit price", "Delivery"],
    lines: (response.lines ?? []).map((line) => ({
      id: line.orderLineReference,
      name: line.name,
      details: present([
        ...itemDetails(line),
        line.maximumBackorderQuantity && `Backorder: ${formatQuantity(line.maximumBackorderQuantity, line.unitCode)}`,
        line.substitute &&
          `Substituted by ${present([
            line.substitute.name,
            line.substitute.sellersId,
            formatIdentifier(line.substitute.standardId),
          ]).join(", ")}`,
      ]),
      cells: [
        nameOf(ORDER_LINE_STATUSES, line.status),
        formatQuantity(line.quantity, line.unitCode),
        line.netPriceAmount ? `${line.netPriceAmount} ${response.currency}` : "",
        formatPeriod(line.promisedDeliveryPeriod) ?? "",
      ],
    })),
    totals: [],
  };
}

export function buildDespatchAdviceTemplateData(
  despatchAdvice: DespatchAdvice,
  context: DocumentRenderContext,
): OperationalTemplateData {
  const shipment = despatchAdvice.shipment;
  const referenced = (role: string, value: DespatchAdvice["buyer"]) =>
    value
      ? [{ role, name: value.name || "-", lines: [], details: present([formatIdentifier(value.identifier)]) }]
      : [];
  return {
    ...base(context, despatchAdvice.despatchAdviceNumber),
    status: null,
    meta: rows([
      ["Issue date", despatchAdvice.issueDate],
      ["Order", despatchAdvice.orderReference],
    ]),
    note: despatchAdvice.note ?? null,
    parties: [
      party("Despatched by", despatchAdvice.despatchParty),
      party("Delivered to", despatchAdvice.consignee),
      ...referenced("Buyer", despatchAdvice.buyer),
      ...referenced("Seller", despatchAdvice.seller),
    ],
    sections: present([
      shipment && {
        title: "Shipment",
        rows: rows([
          ["Shipment", shipment.id],
          ["Despatched", shipment.actualDespatchDate],
          ["Expected", formatPeriod(shipment.estimatedDeliveryPeriod)],
          ["Carrier", shipment.carrier?.name ?? formatIdentifier(shipment.carrier?.identifier)],
          ["Transport", shipment.transportMode && nameOf(TRANSPORT_MODES, shipment.transportMode)],
          ["Consignment", shipment.consignmentId],
          ["Tracking", shipment.trackingId],
          ["Handling units", shipment.handlingUnitCount?.toString()],
          ["Gross weight", shipment.grossWeight && formatQuantity(shipment.grossWeight.value, shipment.grossWeight.unitCode)],
          ["Gross volume", shipment.grossVolume && formatQuantity(shipment.grossVolume.value, shipment.grossVolume.unitCode)],
          ["Information", shipment.information],
        ]),
      },
    ]),
    columns: ["Delivered", "Outstanding", "Order line"],
    lines: despatchAdvice.lines.map((line, index) => ({
      id: line.id || String(index + 1),
      name: line.name,
      details: present([
        ...itemDetails(line),
        line.outstandingReason && `Outstanding: ${line.outstandingReason}`,
        ...(line.itemInstances ?? []).map((instance) =>
          present([
            instance.serialId && `Serial ${instance.serialId}`,
            instance.lotNumber && `Lot ${instance.lotNumber}`,
            instance.expiryDate && `expires ${instance.expiryDate}`,
            instance.bestBeforeDate && `best before ${instance.bestBeforeDate}`,
            instance.manufactureDate && `made ${instance.manufactureDate}`,
          ]).join(", "),
        ),
      ]),
      cells: [
        formatQuantity(line.quantity, line.unitCode),
        formatQuantity(line.outstandingQuantity, line.unitCode),
        present([line.orderReference, line.orderLineReference]).join(" / "),
      ],
    })),
    totals: [],
  };
}

export async function renderOrder<F extends "html" | "pdf">(
  order: Order,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
) {
  return renderTemplate(OPERATIONAL_DOCUMENT_TEMPLATE, buildOrderTemplateData(order, context), options);
}

export async function renderOrderResponse<F extends "html" | "pdf">(
  response: OrderResponse,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
) {
  return renderTemplate(
    OPERATIONAL_DOCUMENT_TEMPLATE,
    buildOrderResponseTemplateData(response, context),
    options,
  );
}

export async function renderDespatchAdvice<F extends "html" | "pdf">(
  despatchAdvice: DespatchAdvice,
  options: { format: F; pdfa?: boolean },
  context: DocumentRenderContext,
) {
  return renderTemplate(
    OPERATIONAL_DOCUMENT_TEMPLATE,
    buildDespatchAdviceTemplateData(despatchAdvice, context),
    options,
  );
}
