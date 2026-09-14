import type {
  deliveryChannels,
  deliveryFailureCategories,
  deliveryStatuses,
  documentDeliveries,
} from "@peppol/db/schema";

// The pure part of the deliveries model: what a delivery is, how a channel's report
// moves it on, and how a document's deliveries are summarised. Nothing here touches
// the database, so every rule can be asserted directly (see data/deliveries).

export type DeliveryChannel = (typeof deliveryChannels)[number];
export type DeliveryStatus = (typeof deliveryStatuses)[number];
export type DeliveryFailureCategory = (typeof deliveryFailureCategories)[number];

export type DocumentDelivery = typeof documentDeliveries.$inferSelect;

/** The columns of a delivery its API shape is built from. */
export type DeliveryRow = Pick<
  DocumentDelivery,
  | "id"
  | "transmittedDocumentId"
  | "channel"
  | "address"
  | "status"
  | "statusChangedAt"
  | "failureCategory"
  | "failureMessage"
  | "failureProviderCode"
>;

export type DeliveryFailure = {
  category: DeliveryFailureCategory;
  message: string | null;
  /** The provider's own code for the failure, when it reported one. */
  providerCode: string | null;
};

/** Identifiers of a transmission on its channel, as the API exposes them. */
export type DeliveryReferences = {
  peppolMessageId?: string | null;
  peppolConversationId?: string | null;
  envelopeId?: string | null;
};

/** A delivery as the API and the dashboard see it. */
export type DeliverySummary = {
  id: string;
  channel: DeliveryChannel;
  address: string;
  status: DeliveryStatus;
  statusChangedAt: string;
  failure: DeliveryFailure | null;
  references: DeliveryReferences;
};

/**
 * What a provider says became of a transmission it had accepted. Reported through its
 * webhook or fetched by the reconciliation poll; either way applied the same.
 */
export type ProviderDeliveryReport = {
  channel: DeliveryChannel;
  provider: string;
  providerTransactionId: string;
  useTestNetwork: boolean;
  status: Exclude<DeliveryStatus, "pending">;
  failure: DeliveryFailure | null;
  /** The provider's id and name for the event that carried the report; null for a poll. */
  eventId: string | null;
  eventType: string | null;
  /** The report as received, kept for support. */
  payload: Record<string, unknown>;
};

/** The statuses a delivery can still move on from. */
const OPEN_STATUSES: ReadonlySet<DeliveryStatus> = new Set(["pending"]);

export function isOpenDeliveryStatus(status: DeliveryStatus): boolean {
  return OPEN_STATUSES.has(status);
}

/**
 * Whether a report moves a delivery from its current status to the reported one.
 * Only an open delivery moves: a final status is never overwritten by a report that
 * arrives late or twice, so a retried or out-of-order report changes nothing.
 */
export function deliveryStatusMoves(
  current: DeliveryStatus,
  reported: DeliveryStatus
): boolean {
  return isOpenDeliveryStatus(current) && current !== reported;
}

/**
 * A document's delivery status, summarised across its deliveries: `delivered` when
 * it reached the recipient over at least one channel, `failed` when every delivery
 * failed, `pending` while any is still open, and null for a document with none.
 */
export function summarizeDeliveryStatus(
  statuses: readonly DeliveryStatus[]
): DeliveryStatus | null {
  if (statuses.length === 0) {
    return null;
  }
  if (statuses.some((status) => status === "delivered")) {
    return "delivered";
  }
  if (statuses.every((status) => status === "failed")) {
    return "failed";
  }
  return "pending";
}

export function deliveryFailureOf(
  delivery: Pick<
    DocumentDelivery,
    "status" | "failureCategory" | "failureMessage" | "failureProviderCode"
  >
): DeliveryFailure | null {
  if (delivery.status !== "failed") {
    return null;
  }
  return {
    category: delivery.failureCategory ?? "other",
    message: delivery.failureMessage,
    providerCode: delivery.failureProviderCode,
  };
}

/**
 * The references a delivery is known by on its channel. They live on the document,
 * which is where every Peppol transmission records them; other channels have none.
 */
export function deliveryReferences(
  channel: DeliveryChannel,
  document: {
    peppolMessageId?: string | null;
    peppolConversationId?: string | null;
    envelopeId?: string | null;
  }
): DeliveryReferences {
  if (channel !== "peppol") {
    return {};
  }
  return {
    peppolMessageId: document.peppolMessageId ?? null,
    peppolConversationId: document.peppolConversationId ?? null,
    envelopeId: document.envelopeId ?? null,
  };
}

export function toDeliverySummary(
  delivery: Omit<DeliveryRow, "transmittedDocumentId">,
  document: Parameters<typeof deliveryReferences>[1]
): DeliverySummary {
  return {
    id: delivery.id,
    channel: delivery.channel,
    address: delivery.address,
    status: delivery.status,
    statusChangedAt: delivery.statusChangedAt.toISOString(),
    failure: deliveryFailureOf(delivery),
    references: deliveryReferences(delivery.channel, document),
  };
}

export type WithDeliveries<T> = T & {
  deliveries: DeliverySummary[];
  deliveryStatus: DeliveryStatus | null;
};

/**
 * Attaches to each document its deliveries and their summary. Documents without any
 * (incoming ones, filed reports) get an empty list and a null status.
 */
export function attachDeliveries<
  T extends {
    id: string;
    peppolMessageId?: string | null;
    peppolConversationId?: string | null;
    envelopeId?: string | null;
  },
>(documents: T[], deliveries: DeliveryRow[]): WithDeliveries<T>[] {
  const byDocument = new Map<string, DeliverySummary[]>();
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  for (const delivery of deliveries) {
    const document = documentsById.get(delivery.transmittedDocumentId);
    if (!document) continue;
    const list = byDocument.get(document.id) ?? [];
    list.push(toDeliverySummary(delivery, document));
    byDocument.set(document.id, list);
  }
  return documents.map((document) => {
    const list = byDocument.get(document.id) ?? [];
    return {
      ...document,
      deliveries: list,
      deliveryStatus: summarizeDeliveryStatus(list.map((delivery) => delivery.status)),
    };
  });
}

// --- Provider-specific interpretation -------------------------------------------

/**
 * The categories the Arratech API reports a failed transaction under, mapped to
 * ours. Mapped by category rather than by the finer-grained code, which stays next to
 * the failure as the provider code. Anything not listed is `other`.
 */
const ARRATECH_FAILURE_CATEGORIES: Record<string, DeliveryFailureCategory> = {
  RECIPIENT_NOT_FOUND: "recipient_not_found",
  NETWORK_LOOKUP_ERROR: "recipient_not_found",
  DOCUMENT_TYPE_NOT_SUPPORTED: "document_not_supported",
  VALIDATION_ERROR: "validation",
  POLICY_VIOLATION: "validation",
  TRANSPORT_ERROR: "transport",
  CERTIFICATE_ERROR: "transport",
  RECIPIENT_REJECTED: "recipient_rejected",
  DUPLICATE: "duplicate",
};

export function categorizeArratechServiceError(
  category: string | null | undefined
): DeliveryFailureCategory {
  if (!category) {
    return "other";
  }
  return ARRATECH_FAILURE_CATEGORIES[category.toUpperCase()] ?? "other";
}

export type ArratechServiceError = {
  code: string;
  message: string;
  category: string;
};

export function arratechFailure(
  error: ArratechServiceError | null | undefined
): DeliveryFailure {
  return {
    category: categorizeArratechServiceError(error?.category),
    message: error?.message ?? null,
    providerCode: error?.code ?? null,
  };
}

/**
 * What an Arratech transaction's status says about its delivery. `COMPLETED` is a
 * delivery; `FAILED` and `REJECTED` are failures. Every other status, including
 * `COMPLETED_NO_DELIVERY` whose meaning is not settled, leaves the delivery as it is
 * and is returned as null so the caller can log it.
 */
export function interpretArratechTransactionStatus(transaction: {
  transactionStatus?: string | null;
  serviceError?: ArratechServiceError | null;
}): Pick<ProviderDeliveryReport, "status" | "failure"> | null {
  switch (transaction.transactionStatus?.toUpperCase()) {
    case "COMPLETED":
      return { status: "delivered", failure: null };
    case "FAILED":
    case "REJECTED":
      return { status: "failed", failure: arratechFailure(transaction.serviceError) };
    default:
      return null;
  }
}
