import { createMiddleware } from "hono/factory";
import { Counter, Gauge, Histogram, registry } from "./registry";

const requestsTotal = registry.register(
  new Counter(
    "peppol_send_document_requests_total",
    "Total number of send document API requests, by outcome and HTTP status.",
    ["outcome", "status"]
  )
);

const requestDuration = registry.register(
  new Histogram(
    "peppol_send_document_duration_seconds",
    "End to end duration of send document API requests, by outcome.",
    ["outcome"]
  )
);

const inFlight = registry.register(
  new Gauge(
    "peppol_send_document_in_flight",
    "Number of send document API requests currently being handled."
  )
);

const deliveriesTotal = registry.register(
  new Counter(
    "peppol_send_document_deliveries_total",
    "Successful document deliveries, by channel and document type.",
    ["channel", "document_type"]
  )
);

/**
 * Maps an HTTP status to a coarse outcome label, keeping the metric cardinality
 * low while still separating client rejections from delivery problems.
 */
function outcomeForStatus(status: number): string {
  if (status < 400) return "success";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 422) return "delivery_failed";
  if (status < 500) return "rejected";
  return "error";
}

/**
 * Records request count, duration and concurrency for the send document
 * endpoint. Mount this as the first middleware of the route so that time spent
 * in authentication and validation is included.
 */
export const trackSendDocument = createMiddleware(async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  inFlight.inc();
  try {
    await next();
    status = c.res?.status ?? 200;
  } finally {
    inFlight.dec();
    const outcome = outcomeForStatus(status);
    requestsTotal.inc({ outcome, status: String(status) });
    requestDuration.observe(
      { outcome },
      (performance.now() - startedAt) / 1000
    );
  }
});

/**
 * Records what was actually delivered for a successfully handled request.
 */
export function recordSendDocumentDelivery(params: {
  documentType: string;
  sentOverPeppol: boolean;
  emailRecipientCount: number;
}): void {
  const documentType = params.documentType || "unknown";
  if (params.sentOverPeppol) {
    deliveriesTotal.inc({ channel: "peppol", document_type: documentType });
  }
  if (params.emailRecipientCount > 0) {
    deliveriesTotal.inc(
      { channel: "email", document_type: documentType },
      params.emailRecipientCount
    );
  }
}
