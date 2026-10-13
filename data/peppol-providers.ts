import type { accessPointProviderIds } from "@peppol/db/schema";
import { UserFacingError } from "@peppol/utils/util";
import { getSmpProviderDescriptor, type SmpProviderId } from "@peppol/data/smp-providers/descriptors";

export type AccessPointProviderId = (typeof accessPointProviderIds)[number];
export type { SmpProviderId };

export type PeppolProviders = {
  accessPointProvider: AccessPointProviderId;
  smpProvider: SmpProviderId;
};

const DEFAULT_PEPPOL_PROVIDERS: PeppolProviders = {
  accessPointProvider: "recommand-ap1",
  smpProvider: "recommand-smp1",
};

/**
 * Countries served by other providers than our own access point and SMP. French
 * companies go through the access point and SMP that operate under the French
 * regime. Norwegian companies are registered in ELMA, the Norwegian receiver
 * register, and receive through our own access point.
 */
const COUNTRY_PEPPOL_PROVIDERS: Partial<Record<string, PeppolProviders>> = {
  FR: { accessPointProvider: "at-shared-ap-fr", smpProvider: "at-shared-smp-fr" },
  NO: { accessPointProvider: "recommand-ap1", smpProvider: "elma-smp-no" },
};

/**
 * The access point and SMP a company in a country is served by. The country decides;
 * customers never pick a provider, they pick a country. A country whose SMP is not
 * yet switched on for the network keeps our own providers, the ones its companies
 * had before.
 */
export function resolveDefaultPeppolProviders(
  country: string,
  network: { useTestNetwork: boolean }
): PeppolProviders {
  const providers = COUNTRY_PEPPOL_PROVIDERS[country.toUpperCase()];
  if (!providers || !getSmpProviderDescriptor(providers.smpProvider).isAvailable(network.useTestNetwork)) {
    return DEFAULT_PEPPOL_PROVIDERS;
  }
  return providers;
}

export function samePeppolProviders(
  left: PeppolProviders,
  right: PeppolProviders
): boolean {
  return (
    left.accessPointProvider === right.accessPointProvider &&
    left.smpProvider === right.smpProvider
  );
}

/**
 * The identifier schemes an SMP accepts for the participants it registers, or null
 * when it takes any scheme.
 */
export function getSupportedIdentifierSchemes(
  smpProvider: SmpProviderId
): readonly string[] | null {
  return getSmpProviderDescriptor(smpProvider).identifierSchemes;
}

export function isIdentifierSchemeSupported(
  smpProvider: SmpProviderId,
  scheme: string
): boolean {
  const supported = getSupportedIdentifierSchemes(smpProvider);
  return supported === null || supported.includes(scheme);
}

/**
 * The customer-facing reason a scheme is refused. It names the network registration
 * the company has, not the provider behind it.
 */
export function describeUnsupportedIdentifierSchemes(
  smpProvider: SmpProviderId,
  schemes: readonly string[]
): string {
  const supported = getSupportedIdentifierSchemes(smpProvider) ?? [];
  const refused = [...new Set(schemes)];
  return (
    `The Peppol registration of this company only supports identifier scheme${supported.length === 1 ? "" : "s"} ${supported.join(", ")}. ` +
    `Scheme${refused.length === 1 ? "" : "s"} ${refused.join(", ")} cannot be used for it.`
  );
}

export function assertIdentifierSchemeSupported(
  smpProvider: SmpProviderId,
  scheme: string
): void {
  if (!isIdentifierSchemeSupported(smpProvider, scheme)) {
    throw new UserFacingError(describeUnsupportedIdentifierSchemes(smpProvider, [scheme]));
  }
}

/**
 * Whether an access point confirms delivery in the send itself. Our own access point
 * returns the recipient's AS4 receipt in the same request, so a send that succeeded
 * is a delivery. A shared access point accepts the document first and reports what
 * became of it later, so its deliveries start out pending.
 */
export function accessPointConfirmsDeliveryOnSend(
  provider: AccessPointProviderId
): boolean {
  return provider !== "at-shared-ap-fr";
}
