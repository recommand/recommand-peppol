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
  | "providerTransactionId"
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
  /** The mail service's id for the message an email delivery was sent as. */
  messageId?: string | null;
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
  /**
   * Our own id for the delivery, when the provider echoes it back: a mail service
   * returns the metadata a message was sent with. Matched before the transaction id.
   */
  deliveryId?: string | null;
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
 * The references a delivery is known by on its channel. A Peppol transmission's
 * live on the document, which records them for the transmission as a whole; an
 * email delivery's is the message id the mail service gave that one message, which
 * the delivery itself keeps as its provider reference.
 */
export function deliveryReferences(
  channel: DeliveryChannel,
  document: {
    peppolMessageId?: string | null;
    peppolConversationId?: string | null;
    envelopeId?: string | null;
  },
  delivery: { providerTransactionId?: string | null } = {}
): DeliveryReferences {
  switch (channel) {
    case "peppol":
      return {
        peppolMessageId: document.peppolMessageId ?? null,
        peppolConversationId: document.peppolConversationId ?? null,
        envelopeId: document.envelopeId ?? null,
      };
    case "email":
      return { messageId: delivery.providerTransactionId ?? null };
  }
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
    references: deliveryReferences(delivery.channel, document, delivery),
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

// --- Email, through Postmark -------------------------------------------------------

/** The mail service every document email goes through, as recorded on its deliveries. */
export const EMAIL_DELIVERY_PROVIDER = "postmark";

// A document email is sent with the delivery it belongs to as message metadata. The
// mail service returns the metadata with every report about the message, so a report
// finds its delivery by our own id and needs the message id only as a fallback.
const METADATA_DELIVERY_ID = "deliveryId";
const METADATA_DOCUMENT_ID = "documentId";

export function documentEmailMetadata(reference: {
  deliveryId: string;
  documentId: string;
}): Record<string, string> {
  return {
    [METADATA_DELIVERY_ID]: reference.deliveryId,
    [METADATA_DOCUMENT_ID]: reference.documentId,
  };
}

/**
 * The delivery a mail service report is about, from the metadata it returns, or null
 * for a message that was not a document delivery (a notification, a verification
 * mail) and carries none.
 */
export function deliveryIdFromEmailMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.[METADATA_DELIVERY_ID];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The bounce types Postmark reports, mapped to our failure categories. A type that
 * says the address does not exist is `recipient_not_found`; one that says the
 * receiving server did not take the message this time is `transport`; one that says
 * the recipient or their server refused it is `recipient_rejected`. The type itself
 * stays next to the failure as the provider code.
 */
const POSTMARK_BOUNCE_CATEGORIES: Record<string, DeliveryFailureCategory> = {
  HARDBOUNCE: "recipient_not_found",
  BADEMAILADDRESS: "recipient_not_found",
  SOFTBOUNCE: "transport",
  TRANSIENT: "transport",
  DNSERROR: "transport",
  DMARCPOLICY: "transport",
  SPAMNOTIFICATION: "recipient_rejected",
  SPAMCOMPLAINT: "recipient_rejected",
  BLOCKED: "recipient_rejected",
  MANUALLYDEACTIVATED: "recipient_rejected",
};

// Postmark files these under bounces although they say nothing about whether the
// message arrived: an out-of-office reply, a challenge-response request, a list
// subscription change, an address-change notice. They are logged and leave the
// delivery as it is.
const POSTMARK_INFORMATIONAL_BOUNCE_TYPES: ReadonlySet<string> = new Set([
  "AUTORESPONDER",
  "CHALLENGEVERIFICATION",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "ADDRESSCHANGE",
]);

export function categorizePostmarkBounce(
  type: string | null | undefined
): DeliveryFailureCategory {
  if (!type) {
    return "other";
  }
  return POSTMARK_BOUNCE_CATEGORIES[type.toUpperCase()] ?? "other";
}

export function isInformationalPostmarkBounce(type: string | null | undefined): boolean {
  return !!type && POSTMARK_INFORMATIONAL_BOUNCE_TYPES.has(type.toUpperCase());
}

/** What Postmark says about a bounce, in a webhook or from its bounces API. */
export type PostmarkBounce = {
  Type?: string | null;
  TypeCode?: number | null;
  Description?: string | null;
  Details?: string | null;
};

export function postmarkBounceFailure(bounce: PostmarkBounce): DeliveryFailure {
  const message = [bounce.Description, bounce.Details]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(" ");
  return {
    category: categorizePostmarkBounce(bounce.Type),
    message: message || null,
    providerCode:
      bounce.Type ?? (bounce.TypeCode != null ? String(bounce.TypeCode) : null),
  };
}

/** A Postmark webhook record, as much of it as the interpretation needs. */
export type PostmarkWebhookRecord = PostmarkBounce & {
  RecordType: string;
};

export type PostmarkWebhookInterpretation =
  | { kind: "report"; status: Exclude<DeliveryStatus, "pending">; failure: DeliveryFailure | null }
  /** The record says nothing about whether the message arrived. */
  | { kind: "informational"; reason: string };

/**
 * What a bounce says became of the message: a failure with its type as the reason,
 * or nothing at all for the types that are not delivery outcomes. Both paths that
 * see a bounce, the webhook and the reconciliation poll, decide through this, so
 * neither can start treating an out-of-office reply as a failed delivery.
 */
export function interpretPostmarkBounce(bounce: PostmarkBounce): PostmarkWebhookInterpretation {
  if (isInformationalPostmarkBounce(bounce.Type)) {
    return { kind: "informational", reason: `bounce type ${bounce.Type}` };
  }
  return { kind: "report", status: "failed", failure: postmarkBounceFailure(bounce) };
}

/**
 * What a Postmark webhook says became of a message. A delivery record confirms it
 * arrived; a bounce or spam complaint fails it with the bounce's type as the reason,
 * except for the bounce types that are not delivery outcomes at all. Opens, clicks
 * and subscription changes are not passed here: they never concern a delivery.
 */
export function interpretPostmarkWebhook(
  record: PostmarkWebhookRecord
): PostmarkWebhookInterpretation | null {
  switch (record.RecordType) {
    case "Delivery":
      return { kind: "report", status: "delivered", failure: null };
    case "Bounce":
    case "SpamComplaint":
      return interpretPostmarkBounce(record);
    default:
      return null;
  }
}

/** One event in the history of an outbound message, from Postmark's messages API. */
export type PostmarkMessageEvent = {
  Type: string;
  ReceivedAt: string;
  Details?: Record<string, unknown> | null;
};

export type PostmarkMessageOutcome =
  | { status: "delivered"; event: PostmarkMessageEvent }
  | { status: "failed"; event: PostmarkMessageEvent; bounceId: number | null; summary: string | null };

/**
 * The bounce a message event points at. The messages API documents the id as a
 * numeric string and the bounces API takes a number, so a string of digits is a
 * bounce id as much as a number is; anything else means there is no bounce to
 * look up.
 */
export function postmarkBounceId(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * What a message's event history says about its delivery, latest first: its delivery
 * and bounce events, in the order that decides, so a bounce that follows a relay's
 * acceptance comes before that acceptance and a delivery that follows a transient
 * delay is there at all. Transient delays, opens and clicks say nothing final and
 * are left out; a message with none of the deciding events is still on its way and
 * yields nothing.
 *
 * The caller gets every candidate rather than only the latest because a bounce can
 * turn out to be an out-of-office reply, which decides nothing and must not hide a
 * delivery confirmation that came before it.
 */
export function postmarkMessageOutcomes(
  events: readonly PostmarkMessageEvent[]
): PostmarkMessageOutcome[] {
  return events
    .filter((event) => ["DELIVERED", "BOUNCED"].includes(event.Type.toUpperCase()))
    .sort((left, right) => Date.parse(right.ReceivedAt) - Date.parse(left.ReceivedAt))
    .map((event) => {
      if (event.Type.toUpperCase() === "DELIVERED") {
        return { status: "delivered", event } as const;
      }
      const summary = event.Details?.Summary;
      return {
        status: "failed",
        event,
        bounceId: postmarkBounceId(event.Details?.BounceID),
        summary: typeof summary === "string" && summary ? summary : null,
      } as const;
    });
}
