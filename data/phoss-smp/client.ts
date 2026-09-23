const SMP_ENDPOINT = "https://smp.net.recommand.com";
const SMP_TEST_ENDPOINT = "https://test-smp.net.recommand.com";

export function getSmpEndpoint(useTestNetwork: boolean | undefined): string {
  return useTestNetwork ? SMP_TEST_ENDPOINT : SMP_ENDPOINT;
}

/** Whether an SMP URL, as the SML resolves it, points at our own SMP. */
export function isRecommandSmpUrl(url: string, useTestNetwork: boolean | undefined): boolean {
  try {
    return new URL(url).hostname === new URL(getSmpEndpoint(useTestNetwork)).hostname;
  } catch {
    return false;
  }
}

// Extend fetch with the bearer token
export function fetchSmp(url: string, options: {useTestNetwork?: boolean} & RequestInit) {
  const endpoint = getSmpEndpoint(options.useTestNetwork);
  const token = options.useTestNetwork ? process.env.PHOSS_SMP_TEST_TOKEN : process.env.PHOSS_SMP_TOKEN;
  return fetch(endpoint + "/" + url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}