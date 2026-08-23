/**
 * HTTP client and preflight checks for the send document regression suite.
 *
 * Like the end-to-end suite next door, this folder is standalone: it imports
 * nothing from the application packages, not even the dev server helper. The
 * server is started by the preloaded `test/setup.ts`; everything here talks to
 * it over HTTP only, so the suite keeps describing the observable contract
 * however the internals are refactored.
 */

export const HOST = (
  process.env.ETE_UNIT_TEST_HOST || "http://localhost:3000"
).replace(/\/+$/, "");

export const COMPANY_ID = process.env.ETE_UNIT_TEST_COMPANY_ID ?? "";
export const TOKEN = process.env.ETE_UNIT_TEST_JWT ?? "";

export const PLAYGROUND_PATH = "/api/peppol/playgrounds/current";

export type ApiResponse = { status: number; body: any };

export async function api(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const response = await fetch(`${HOST}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the raw text so failures stay readable.
  }
  return { status: response.status, body };
}

export function sendDocument(
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  return api(path, { method: "POST", body });
}

/**
 * The XML that was transmitted for a document, as the API itself hands it
 * back. `GET /documents/:id` answers with the stored XML when XML is asked
 * for, which is the same string the recording captured on the sending side.
 *
 * Returns null when the document has no XML (a send without a recipient) or
 * when the XML is no longer available (offloaded storage), in which case the
 * route falls back to its JSON representation.
 */
export async function getDocumentXml(
  documentId: string,
): Promise<string | null> {
  const response = await fetch(`${HOST}/api/peppol/documents/${documentId}`, {
    headers: {
      Accept: "application/xml",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("xml")) return null;
  const xml = await response.text();
  return xml.trim() ? xml : null;
}

export function requireConfig(): void {
  const missing = [
    !process.env.ETE_UNIT_TEST_COMPANY_ID && "ETE_UNIT_TEST_COMPANY_ID",
    !process.env.ETE_UNIT_TEST_JWT && "ETE_UNIT_TEST_JWT",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration: ${missing.join(", ")}. See test/regression/README.md. ` +
        `The suite must point at a playground team.`,
    );
  }
}

/**
 * Waits for the API to answer. The preloaded setup starts a dev server when
 * nothing is listening, but a cold start also runs migrations, so the first
 * request can arrive before the routes are mounted.
 */
export async function waitForApi(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no request completed";
  while (Date.now() < deadline) {
    try {
      const response = await api(`/api/peppol/companies/${COMPANY_ID}`);
      if (response.status < 500) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API at ${HOST} never answered: ${lastError}`);
}

/**
 * Refuses to run against anything but a playground team on the simulated
 * network. This suite replays real production payloads, so without this check
 * a misconfigured run would put other people's invoices onto the live Peppol
 * network. `isPlayground` and `useTestNetwork` are the two flags the API
 * itself uses to decide whether a send leaves the building. Nothing is sent by
 * the check itself.
 */
export async function assertPlaygroundTeam(): Promise<void> {
  const response = await api(PLAYGROUND_PATH);
  const playground = response.body?.playground;

  const refuse: (reason: string) => never = (reason) => {
    throw new Error(
      `Refusing to run: ${HOST} company ${COMPANY_ID} ${reason}. ` +
        `The regression suite only runs against a playground team with the test network disabled.\n` +
        `GET ${PLAYGROUND_PATH} returned ${response.status}: ${JSON.stringify(response.body)}`,
    );
  };

  if (response.status !== 200 || playground?.isPlayground !== true) {
    refuse("does not belong to a playground team");
  }
  if (playground.useTestNetwork !== false) {
    refuse("belongs to a playground team that uses the Peppol test network");
  }
}
