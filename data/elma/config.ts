// ELMA is the Norwegian receiver register, an SMP run by the Norwegian Digitalisation
// Agency (Digdir). Service providers register their participants through its REST
// API; ELMA routes each participant to the access point of the provider's active
// agreement for the participant's domain, and updates the SML and the Peppol
// Directory itself.
//
// Production and test are configured separately. The test network uses ELMA's test
// environment, whose address is configured rather than assumed.

const DEFAULT_PRODUCTION_API_URL = "https://elma-smp.no/rest";

export type ElmaConfig = {
  apiUrl: string;
  username: string;
  password: string;
  /** Our service provider's identifier in ELMA, the target of a transfer to us. */
  serviceProviderId: string;
};

function prefix(useTestNetwork: boolean): string {
  return useTestNetwork ? "ELMA_TEST_" : "ELMA_";
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/**
 * Whether new Norwegian companies on the given network are registered in ELMA.
 * Switched on per network once our access point has an active agreement in ELMA
 * for that environment; until then they stay on our own SMP.
 */
export function isElmaEnabled(useTestNetwork: boolean): boolean {
  return process.env[`${prefix(useTestNetwork)}ENABLED`] === "true";
}

export function getElmaConfig(useTestNetwork: boolean): ElmaConfig {
  const p = prefix(useTestNetwork);
  return {
    apiUrl: (useTestNetwork ? getEnv(`${p}API_URL`) : process.env[`${p}API_URL`] || DEFAULT_PRODUCTION_API_URL).replace(/\/+$/, ""),
    username: getEnv(`${p}USERNAME`),
    password: getEnv(`${p}PASSWORD`),
    serviceProviderId: getEnv(`${p}SERVICE_PROVIDER_ID`),
  };
}
