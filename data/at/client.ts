import { UserFacingError } from "@directory/utils/util";

type ArratechConfig = {
  endpoint: string;
  apiKey: string;
  orgId: string;
  smpRef: string;
  apRef: string;
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export function getArratechConfig(useTestNetwork: boolean): ArratechConfig {
  return {
    endpoint: (
      useTestNetwork
        ? process.env.ARRATECH_TEST_API_URL ?? process.env.ARRATECH_API_URL
        : process.env.ARRATECH_API_URL
    ) ?? "https://api.arratech.com",
    apiKey: getEnv(useTestNetwork ? "ARRATECH_TEST_API_KEY" : "ARRATECH_API_KEY"),
    orgId: getEnv(useTestNetwork ? "ARRATECH_TEST_ORG_ID" : "ARRATECH_ORG_ID"),
    smpRef: getEnv(useTestNetwork ? "ARRATECH_TEST_SMP_REF" : "ARRATECH_SMP_REF"),
    apRef: getEnv(useTestNetwork ? "ARRATECH_TEST_AP_REF" : "ARRATECH_AP_REF"),
  };
}

async function getErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText;
  }

  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return json.error ?? json.message ?? text;
  } catch {
    return text;
  }
}

export async function fetchArratech(
  path: string,
  options: { useTestNetwork: boolean } & RequestInit
): Promise<Response> {
  const config = getArratechConfig(options.useTestNetwork);
  const endpoint = config.endpoint.endsWith("/")
    ? config.endpoint.slice(0, -1)
    : config.endpoint;
  const urlPath = path.startsWith("/") ? path : `/${path}`;

  return fetch(`${endpoint}${urlPath}`, {
    ...options,
    headers: {
      ...options.headers,
      "X-API-Key": config.apiKey,
    },
  });
}

/**
 * Resolves with `promise`, or rejects as soon as `signal` aborts. A response whose
 * body never ends keeps the fetch's own promise pending, so a caller's deadline has
 * to cover reading the body as well as receiving the headers.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Request aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Fetches JSON from the provider. A `signal` in the options bounds the whole
 * exchange: the request, the wait for the response and the reading of its body.
 */
export async function fetchArratechJson<T>(
  path: string,
  options: { useTestNetwork: boolean } & RequestInit
): Promise<T> {
  const response = await fetchArratech(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await untilAborted(getErrorMessage(response), options.signal);
    throw new UserFacingError(`AT request failed: ${message}`);
  }

  return await untilAborted(response.json() as Promise<T>, options.signal);
}
