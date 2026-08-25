/**
 * Minimal HTTP client for the send-document end-to-end suite.
 *
 * This suite is deliberately standalone: it imports nothing from the
 * application packages, so it keeps describing the *observable* API contract
 * even when internals are refactored. Everything it knows about the API
 * (routes, status codes, response shapes, error messages, doctype ids) is
 * spelled out here and in the test file.
 */

import { getTestHost } from "../utils/dev-server";

/** The same host the dev server helper starts and waits for. */
export const HOST = getTestHost();
export const COMPANY_ID = process.env.ETE_UNIT_TEST_COMPANY_ID ?? "";
export const TOKEN = process.env.ETE_UNIT_TEST_JWT ?? "";

/** Postmark discards anything sent to blackhole.postmarkapp.com. */
export const EMAIL_TO =
  process.env.ETE_UNIT_TEST_EMAIL_TO ?? "test@blackhole.postmarkapp.com";
export const EMAIL_TO_2 =
  process.env.ETE_UNIT_TEST_EMAIL_TO_2 ?? "test+2@blackhole.postmarkapp.com";

/** A Peppol address that is reachable (not registered in the playground team). */
export const RECIPIENT = process.env.ETE_UNIT_TEST_RECIPIENT ?? "0208:0598726857";

/** Hardcoded in the playground access point simulator as "does not exist". */
export const UNREACHABLE_RECIPIENT = "0208:1234567894";
export const SIMULATED_PEPPOL_FAILURE =
  "This document was sent to recipient 404:404 or 0208:1234567894, simulating the sending of a document to a Peppol address that does not exist.";

export const SEND_PATH = `/api/peppol/${COMPANY_ID}/send`;
export const SEND_DOCUMENT_PATH = `/api/peppol/${COMPANY_ID}/sendDocument`;
export const SEND_PATH_V1 = `/api/v1/${COMPANY_ID}/send`;
/** Answers for the team the token belongs to, and 404s on a non playground team. */
export const PLAYGROUND_PATH = "/api/peppol/playgrounds/current";

export type ApiResponse = { status: number; body: any };

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** `undefined` uses the configured token, `null` sends no Authorization header. */
  token?: string | null;
};

export async function api(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResponse> {
  const token = options.token === undefined ? TOKEN : options.token;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${HOST}${path}`, {
    method: options.method ?? "GET",
    headers,
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
  body: unknown,
  options: { path?: string; token?: string | null } = {}
): Promise<ApiResponse> {
  return api(options.path ?? SEND_PATH, {
    method: "POST",
    body,
    token: options.token,
  });
}

export function getDocument(documentId: string): Promise<ApiResponse> {
  return api(`/api/peppol/documents/${documentId}`);
}

/** The send route of a company other than the one the suite is configured with. */
export function sendPathFor(companyId: string): string {
  return `/api/peppol/${companyId}/send`;
}

export function createCompany(company: unknown): Promise<ApiResponse> {
  return api("/api/peppol/companies", { method: "POST", body: company });
}

export function deleteCompany(companyId: string): Promise<ApiResponse> {
  return api(`/api/peppol/companies/${companyId}`, { method: "DELETE" });
}

export function getCompany(): Promise<ApiResponse> {
  return api(`/api/peppol/companies/${COMPANY_ID}`);
}

/**
 * Readiness check used while waiting for the server to boot. Looking up the
 * company the tests send from proves more than a plain request to `/`: the API
 * routes are mounted and the database answers. A 404 or 401 counts as ready
 * too, because the server is clearly serving; the preflight below then reports
 * what is actually wrong instead of timing out with a vague message.
 */
export async function apiIsAnswering(): Promise<boolean> {
  try {
    const response = await getCompany();
    return response.status < 500;
  } catch {
    return false;
  }
}

/** A recipient without a scheme is normalised to the Belgian enterprise scheme. */
export function normaliseRecipient(recipient: string): string {
  if (recipient.includes(":")) {
    return recipient;
  }
  return `0208:${recipient.replace(/[^0-9]/g, "")}`;
}

/** The same address written without its scheme prefix. */
export const BARE_RECIPIENT = RECIPIENT.split(":").pop() ?? RECIPIENT;

export function requireConfig(): void {
  const missing = [
    !process.env.ETE_UNIT_TEST_COMPANY_ID && "ETE_UNIT_TEST_COMPANY_ID",
    !process.env.ETE_UNIT_TEST_JWT && "ETE_UNIT_TEST_JWT",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration: ${missing.join(", ")}. ` +
        `Set them in .env (see e2e/README.md). The suite must point at a playground team.`
    );
  }

  const unreachable = [RECIPIENT, BARE_RECIPIENT].some(
    (value) => normaliseRecipient(value) === UNREACHABLE_RECIPIENT
  );
  if (unreachable) {
    throw new Error(
      `ETE_UNIT_TEST_RECIPIENT must not resolve to ${UNREACHABLE_RECIPIENT}: that address always fails in the playground simulator.`
    );
  }
}

export function getPlayground(): Promise<ApiResponse> {
  return api(PLAYGROUND_PATH);
}

/**
 * Refuses to run against anything but a playground team on the simulated
 * network, so the suite can never send hundreds of documents onto the live
 * Peppol network.
 *
 * `isPlayground` and `useTestNetwork` are the two flags the API itself uses to
 * decide whether a send leaves the building, so asking for them settles the
 * question outright. The endpoint reports on the team the token belongs to and
 * answers 404 for a team that is not a playground. Nothing is sent, and
 * nothing is stored.
 */
export async function assertPlaygroundTeam(): Promise<void> {
  const response = await getPlayground();
  const playground = response.body?.playground;

  // Annotated so TypeScript treats a call as terminating the flow.
  const refuse: (reason: string) => never = (reason) => {
    throw new Error(
      `Refusing to run: ${HOST} company ${COMPANY_ID} ${reason}. ` +
        `The suite only runs against a playground team with the test network disabled.\n` +
        `GET ${PLAYGROUND_PATH} returned ${response.status}: ${JSON.stringify(response.body)}`
    );
  };

  if (response.status !== 200 || playground?.isPlayground !== true) {
    refuse("does not belong to a playground team");
  }
  if (playground.useTestNetwork !== false) {
    refuse("belongs to a playground team that uses the Peppol test network");
  }
}
