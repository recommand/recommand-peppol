import { UserFacingError } from "@peppol/utils/util";

type ArratechConfig = {
  endpoint: string;
  apiKey: string;
  orgId: string;
  smpRef: string;
  apRef: string;
};

function getEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
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
    apiKey: getEnv(
      useTestNetwork ? "ARRATECH_TEST_API_KEY" : "ARRATECH_API_KEY",
      "ARRATECH_API_KEY"
    ),
    orgId: getEnv(
      useTestNetwork ? "ARRATECH_TEST_ORG_ID" : "ARRATECH_ORG_ID",
      "ARRATECH_ORG_ID"
    ),
    smpRef: getEnv(
      useTestNetwork ? "ARRATECH_TEST_SMP_REF" : "ARRATECH_SMP_REF",
      "ARRATECH_SMP_REF"
    ),
    apRef: getEnv(
      useTestNetwork ? "ARRATECH_TEST_AP_REF" : "ARRATECH_AP_REF",
      "ARRATECH_AP_REF"
    ),
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
    const message = await getErrorMessage(response);
    throw new UserFacingError(`AT request failed: ${message}`);
  }

  return await response.json();
}
