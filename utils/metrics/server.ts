import { timingSafeEqual } from "node:crypto";
import type { Logger } from "@recommand/lib/logger";
import { registry } from "./registry";

const DEFAULT_METRICS_PORT = 9464;

/**
 * The metrics endpoint is served on its own port so it is never reachable
 * through the public proxy. It is expected to be firewalled off to the
 * Prometheus node, with the bearer token as a second line of defence.
 */
let metricsServer: ReturnType<typeof Bun.serve> | null = null;

function isAuthorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export function initializeMetricsServer(logger: Logger) {
  if (metricsServer) {
    return;
  }

  const token = process.env.METRICS_TOKEN?.trim();
  if (!token) {
    logger.info("METRICS_TOKEN is not set, not starting the metrics server");
    return;
  }

  const port = Number(process.env.METRICS_PORT ?? DEFAULT_METRICS_PORT);
  const hostname = process.env.METRICS_HOSTNAME?.trim() || "0.0.0.0";

  try {
    metricsServer = Bun.serve({
      port,
      hostname,
      fetch(request) {
        if (new URL(request.url).pathname !== "/metrics") {
          return new Response("Not found", { status: 404 });
        }
        if (!isAuthorized(request, token)) {
          return new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": "Bearer" },
          });
        }
        return new Response(registry.render(), {
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      },
    });
  } catch (error) {
    // Never let monitoring take down the application.
    logger.error("Failed to start the metrics server", error);
    return;
  }

  logger.info(`Metrics server listening on http://${hostname}:${port}/metrics`);
}
