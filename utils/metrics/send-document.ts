import { createMiddleware } from "hono/factory";
import { Counter, Gauge, Histogram, registry } from "./registry";

const requestsTotal = registry.register(
  new Counter(
    "peppol_send_document_requests_total",
    "Total number of send document API requests, by network, outcome and HTTP status.",
    ["network", "outcome", "status"]
  )
);

const requestDuration = registry.register(
  new Histogram(
    "peppol_send_document_duration_seconds",
    "End to end duration of send document API requests, by network and outcome.",
    ["network", "outcome"]
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
    "Successful document deliveries, by network, channel and document type.",
    ["network", "channel", "document_type"]
  )
);

type NetworkTeam = {
  isPlayground?: boolean | null;
  useTestNetwork?: boolean | null;
};

/**
 * Mirrors the branching in the send document endpoint:
 *
 * - `test`       — a real AS4 transmission onto the Peppol test network.
 * - `playground` — simulated, never leaves our own system.
 * - `production` — a real AS4 transmission onto the production Peppol network.
 *
 * `unknown` only happens when the request never got past authentication, so the
 * team was never resolved.
 */
export function networkFor(team?: NetworkTeam | null): string {
  if (!team) return "unknown";
  if (team.useTestNetwork) return "test";
  if (team.isPlayground) return "playground";
  return "production";
}

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

type SendDocumentMetricsContext = {
  Variables: { team: NetworkTeam };
};

/**
 * Records request count, duration and concurrency for the send document
 * endpoint. Mount this as the first middleware of the route so that time spent
 * in authentication and validation is included. The team is only resolved by
 * the auth middleware further down the chain, so the network is read once the
 * request has finished rather than when it started.
 */
export const trackSendDocument = createMiddleware<SendDocumentMetricsContext>(
  async (c, next) => {
    const startedAt = performance.now();
    let status = 500;
    inFlight.inc();
    try {
      await next();
      status = c.res?.status ?? 200;
    } finally {
      inFlight.dec();
      const network = networkFor(c.get("team"));
      const outcome = outcomeForStatus(status);
      requestsTotal.inc({ network, outcome, status: String(status) });
      requestDuration.observe(
        { network, outcome },
        (performance.now() - startedAt) / 1000
      );
    }
  }
);

/**
 * Records what was actually delivered for a successfully handled request.
 */
export function recordSendDocumentDelivery(
  params: NetworkTeam & {
    documentType: string;
    sentOverPeppol: boolean;
    emailRecipientCount: number;
  }
): void {
  const documentType = params.documentType || "unknown";
  const network = networkFor(params);
  if (params.sentOverPeppol) {
    deliveriesTotal.inc({
      network,
      channel: "peppol",
      document_type: documentType,
    });
  }
  if (params.emailRecipientCount > 0) {
    deliveriesTotal.inc(
      { network, channel: "email", document_type: documentType },
      params.emailRecipientCount
    );
  }
}
