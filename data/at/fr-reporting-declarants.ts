import { z } from "zod";
import { fetchArratech, getArratechConfig } from "@peppol/data/at/client";
import type { frReportingEnvironments, frVatExigibilities, frVatRegimes } from "@peppol/db/schema";

/**
 * The partner's registration of a taxpayer we file French e-reporting for. A SIREN
 * is registered per environment, and only one organisation may hold it per
 * environment. Registering also provisions the declarant in the partner's reporting
 * engine, which is what makes its VAT periods due for filing: from that moment on
 * the declarant is expected to report.
 */
export type ArratechDeclarantEnvironment = (typeof frReportingEnvironments)[number];
export type ArratechVatRegime = (typeof frVatRegimes)[number];
export type ArratechVatExigibility = (typeof frVatExigibilities)[number];

export type ArratechDeclarantInput = {
  issuerName: string;
  vatRegime: ArratechVatRegime;
  vatExigibility: ArratechVatExigibility;
  enabled?: boolean;
  /**
   * SELF_SUBMIT means we push the events through the API. PLATFORM_DERIVED would
   * have the partner derive the reporting from invoices flowing through it and
   * close the API for that declarant; we never register that mode.
   */
  intakeMode?: "SELF_SUBMIT" | "PLATFORM_DERIVED";
};

const arratechDeclarantSchema = z
  .object({
    orgId: z.string(),
    siren: z.string(),
    environment: z.enum(["PROD", "TEST"]),
    issuerName: z.string(),
    vatRegime: z.enum(["REEL_NORMAL_MENSUEL", "REEL_SIMPLIFIE", "FRANCHISE_EN_BASE"]),
    vatExigibility: z.enum(["ENCAISSEMENTS", "DEBITS"]),
    enabled: z.boolean(),
    intakeMode: z.enum(["SELF_SUBMIT", "PLATFORM_DERIVED"]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export type ArratechDeclarant = z.infer<typeof arratechDeclarantSchema>;

/** The partner's code for a SIREN that is already held by another organisation. */
export const ARRATECH_DECLARANT_TAKEN = "AT-2704";

/**
 * A failed declarant call. `retryable` says whether the same call can be expected
 * to succeed later (the partner or the network was unavailable) or whether it needs
 * a human (the registration was refused).
 */
export class ArratechDeclarantError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ArratechDeclarantError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

async function readDeclarantError(response: Response): Promise<ArratechDeclarantError> {
  const text = (await response.text()).slice(0, 1000);
  let code: string | null = null;
  let message = text || response.statusText;
  try {
    const json = JSON.parse(text) as { code?: string; error?: string; message?: string };
    code = json.code ?? null;
    message = json.error ?? json.message ?? message;
  } catch {
    // Not JSON: keep the raw text.
  }
  return new ArratechDeclarantError(
    `Arratech declarant request failed with status ${response.status}: ${message}`,
    response.status,
    code,
    isRetryableStatus(response.status),
  );
}

async function declarantRequest(
  path: string,
  options: { useTestNetwork: boolean } & RequestInit,
): Promise<Response> {
  try {
    return await fetchArratech(path, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ArratechDeclarantError(
      `Arratech declarant request failed: ${error instanceof Error ? error.message : String(error)}`,
      null,
      null,
      true,
    );
  }
}

function declarantPath(
  environment: ArratechDeclarantEnvironment,
  siren: string,
  useTestNetwork: boolean,
): string {
  const config = getArratechConfig(useTestNetwork);
  return `/orgs/${config.orgId}/tax-reporting/fr-f10/declarants/${environment}/${siren}`;
}

/**
 * Registers a declarant, or updates its registration. Idempotent on (organisation,
 * environment, SIREN). Throws an ArratechDeclarantError carrying the partner's code;
 * ARRATECH_DECLARANT_TAKEN means another organisation holds the SIREN.
 */
export async function registerArratechDeclarant({
  environment,
  siren,
  input,
  useTestNetwork,
}: {
  environment: ArratechDeclarantEnvironment;
  siren: string;
  input: ArratechDeclarantInput;
  useTestNetwork: boolean;
}): Promise<ArratechDeclarant> {
  const response = await declarantRequest(declarantPath(environment, siren, useTestNetwork), {
    useTestNetwork,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issuerName: input.issuerName,
      vatRegime: input.vatRegime,
      vatExigibility: input.vatExigibility,
      enabled: input.enabled ?? true,
      intakeMode: input.intakeMode ?? "SELF_SUBMIT",
    }),
  });
  if (!response.ok) {
    throw await readDeclarantError(response);
  }
  return arratechDeclarantSchema.parse(await response.json());
}

/** Reads one registration. Returns null when the partner has none for this SIREN. */
export async function fetchArratechDeclarant({
  environment,
  siren,
  useTestNetwork,
}: {
  environment: ArratechDeclarantEnvironment;
  siren: string;
  useTestNetwork: boolean;
}): Promise<ArratechDeclarant | null> {
  const response = await declarantRequest(declarantPath(environment, siren, useTestNetwork), {
    useTestNetwork,
    method: "GET",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await readDeclarantError(response);
  }
  return arratechDeclarantSchema.parse(await response.json());
}

/**
 * Removes a registration and deactivates the declarant in the partner's reporting
 * engine. Removing mid-period leaves that period unfiled, which is why this is a
 * support action and never runs automatically.
 */
export async function removeArratechDeclarant({
  environment,
  siren,
  useTestNetwork,
}: {
  environment: ArratechDeclarantEnvironment;
  siren: string;
  useTestNetwork: boolean;
}): Promise<void> {
  const response = await declarantRequest(declarantPath(environment, siren, useTestNetwork), {
    useTestNetwork,
    method: "DELETE",
  });
  if (response.status === 404 || response.status === 204) {
    return;
  }
  if (!response.ok) {
    throw await readDeclarantError(response);
  }
}
