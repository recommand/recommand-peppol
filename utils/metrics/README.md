# Prometheus metrics

Everything related to Prometheus/Grafana monitoring lives in this folder.

- `registry.ts` — minimal, dependency free counter/gauge/histogram primitives
and Prometheus text exposition.
- `send-document.ts` — the metrics for the send document endpoint.
- `server.ts` — the `/metrics` endpoint, served on its own port.

## Wiring

The endpoint only needs two calls (see `api/send-document.ts`):

- `trackSendDocument` — the first middleware on both send routes.
- `recordSendDocumentDelivery({ ... })` — just before the success response.

`initializeMetricsServer(logger)` is called once from the peppol package `init`.

## Exposed metrics


| Metric                                  | Type      | Labels                                  |
| --------------------------------------- | --------- | --------------------------------------- |
| `peppol_send_document_requests_total`   | counter   | `network`, `outcome`, `status`          |
| `peppol_send_document_duration_seconds` | histogram | `network`, `outcome`                    |
| `peppol_send_document_in_flight`        | gauge     | —                                       |
| `peppol_send_document_deliveries_total` | counter   | `network`, `channel`, `document_type`   |


`outcome` is one of `success`, `unauthorized`, `rejected` (4xx),
`delivery_failed` (422) and `error` (5xx).

`network` separates real customer traffic from the rest, mirroring the branch in
the endpoint itself:

| Value        | Team state                            | What happens                                    |
| ------------ | ------------------------------------- | ----------------------------------------------- |
| `production` | not playground, test network off      | Real AS4 onto the production Peppol network.    |
| `test`       | test network on (playground or not)   | Real AS4 onto the Peppol test network.          |
| `playground` | playground, test network off          | Simulated, never leaves our own system.         |
| `unknown`    | —                                     | Request failed auth, so no team was resolved.   |

`in_flight` is deliberately unlabelled: it is incremented before the auth
middleware has resolved the team, so it could not be decremented under the same
label.

## Configuration


| Variable           | Default   | Description                                                                              |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `METRICS_TOKEN`    | —         | Bearer token required to scrape. **Empty disables the metrics server entirely.**         |
| `METRICS_PORT`     | `9464`    | Port the metrics server listens on.                                                      |
| `METRICS_HOSTNAME` | `0.0.0.0` | Bind address. Keep the default under Docker; the published port is what gets restricted. |




## Deployment

Kamal publishes `9464:9464` on the host (`config/deploy.yml`,
`config/deploy.production-ha.yml`). The port bypasses `kamal-proxy`, so it is
never reachable through the public hostnames.

Restrict the port to the Prometheus node in the host firewall.

The bearer token is the second line of defence, checked in constant time.

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: recommand-peppol
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets:
          - rcmd-prod-hz-01:9464
          - rcmd-prod-do-01:9464
```

Each app server keeps its own in-process counters, so aggregate across
instances in Grafana, e.g.:

Always filter on `network="production"` for alerting, otherwise playground and
test traffic will mask (or fake) real problems:

```promql
sum(rate(peppol_send_document_requests_total{network="production",outcome="error"}[5m]))
histogram_quantile(0.95, sum by (le) (rate(peppol_send_document_duration_seconds_bucket{network="production"}[5m])))
sum by (channel) (rate(peppol_send_document_deliveries_total{network="production"}[5m]))
```

Drop the filter, or group `by (network)`, when you want to see all traffic:

```promql
sum by (network) (rate(peppol_send_document_requests_total[5m]))
```

Counters reset to zero on every deploy (they live in process memory); `rate()`
and `increase()` handle that correctly.