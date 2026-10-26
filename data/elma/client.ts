import { getElmaConfig, type ElmaConfig } from "./config";

// The ELMA REST API (https://elma-smp.no/rest/swagger-ui/index.html). Requests are
// authenticated as our service provider with HTTP Basic. ELMA's responses are read
// defensively: identifiers it documents as {scheme, value} objects are served as
// "scheme::value" strings, so both are accepted.

const REQUEST_TIMEOUT_MS = 30_000;
const PROCESS_PAGE_SIZE = 200;

export const PARTICIPANT_IDENTIFIER_SCHEME = "iso6523-actorid-upis";

export type ElmaQualifiedIdentifier = string | { scheme?: string; value?: string };

export type ElmaProcess = {
  identifier: string;
  qualifiedIdentifier: ElmaQualifiedIdentifier;
  domain?: string;
  title?: string;
  restricted?: boolean;
  /** A participant needs one of these ICDs to be registered for the process. */
  requiredICDs?: string[];
  documentTypes?: { identifier?: string; qualifiedIdentifier: ElmaQualifiedIdentifier; title?: string }[];
  dependencies?: { identifier?: string; qualifiedIdentifier: ElmaQualifiedIdentifier; title?: string }[];
};

export type ElmaParticipant = {
  identifier?: string;
  icd?: string;
  organizationIdentifier?: string;
  name?: string;
  provider?: { identifier?: string; title?: string };
  processes?: ElmaProcess[];
};

export type ElmaContact = {
  name: string;
  email?: string;
  phoneNumber?: string;
};

export type ElmaParticipantForm = {
  processes: { identifier: string }[];
  contact: ElmaContact;
};

export class ElmaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    request: string
  ) {
    super(`ELMA answered ${request} with HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "ElmaApiError";
  }
}

export function qualifiedIdentifierToString(identifier: ElmaQualifiedIdentifier): string {
  if (typeof identifier === "string") {
    return identifier;
  }
  return `${identifier.scheme ?? ""}::${identifier.value ?? ""}`;
}

/** The participant as ELMA addresses it: iso6523-actorid-upis::0192:923609016. */
export function participantPath(icd: string, organisationNumber: string): string {
  return encodeURIComponent(`${PARTICIPANT_IDENTIFIER_SCHEME}::${icd}:${organisationNumber}`);
}

export function createElmaClient(config: ElmaConfig, fetchImpl: typeof fetch = fetch) {
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetchImpl(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response;
  }

  async function expectOk(response: Response, description: string): Promise<Response> {
    if (!response.ok) {
      throw new ElmaApiError(response.status, await response.text(), description);
    }
    return response;
  }

  return {
    serviceProviderId: config.serviceProviderId,

    /** The participant, or null when ELMA does not know it. */
    async getParticipant(icd: string, organisationNumber: string): Promise<ElmaParticipant | null> {
      const response = await request("GET", `/api/participants/${participantPath(icd, organisationNumber)}`);
      if (response.status === 404) {
        return null;
      }
      return (await (await expectOk(response, `GET participant ${icd}:${organisationNumber}`)).json()) as ElmaParticipant;
    },

    async addParticipant(
      icd: string,
      organisationNumber: string,
      name: string,
      form: ElmaParticipantForm
    ): Promise<ElmaParticipant> {
      const response = await request("POST", "/api/participants", {
        icd,
        organizationIdentifier: organisationNumber,
        name,
        ...form,
      });
      return (await (await expectOk(response, `POST participant ${icd}:${organisationNumber}`)).json()) as ElmaParticipant;
    },

    async updateParticipant(icd: string, organisationNumber: string, form: ElmaParticipantForm): Promise<ElmaParticipant> {
      const response = await request("PUT", `/api/participants/${participantPath(icd, organisationNumber)}`, form);
      return (await (await expectOk(response, `PUT participant ${icd}:${organisationNumber}`)).json()) as ElmaParticipant;
    },

    /** Removes the participant. Resolves to false when ELMA did not know it. */
    async deleteParticipant(icd: string, organisationNumber: string): Promise<boolean> {
      const response = await request("DELETE", `/api/participants/${participantPath(icd, organisationNumber)}`);
      if (response.status === 404) {
        return false;
      }
      await expectOk(response, `DELETE participant ${icd}:${organisationNumber}`);
      return true;
    },

    /** Moves a participant registered by another service provider to the given one. */
    async transferParticipant(icd: string, organisationNumber: string, toServiceProviderId: string): Promise<void> {
      const response = await request(
        "PUT",
        `/api/participants/${participantPath(icd, organisationNumber)}/transfer/${encodeURIComponent(toServiceProviderId)}`
      );
      await expectOk(response, `PUT transfer ${icd}:${organisationNumber}`);
    },

    /** Every process ELMA offers, across all pages. */
    async listProcesses(): Promise<ElmaProcess[]> {
      const processes: ElmaProcess[] = [];
      for (let page = 0; ; page++) {
        const response = await request("GET", `/api/processes?size=${PROCESS_PAGE_SIZE}&page=${page}`);
        const body = (await (await expectOk(response, "GET processes")).json()) as {
          content?: ElmaProcess[];
          last?: boolean;
        };
        processes.push(...(body.content ?? []));
        if (body.last !== false || (body.content ?? []).length === 0) {
          return processes;
        }
      }
    },
  };
}

export type ElmaClient = ReturnType<typeof createElmaClient>;

export function getElmaClient(useTestNetwork: boolean): ElmaClient {
  return createElmaClient(getElmaConfig(useTestNetwork));
}
