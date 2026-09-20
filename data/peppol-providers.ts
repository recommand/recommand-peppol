import type { accessPointProviderIds, smpProviderIds } from "@peppol/db/schema";
import { UserFacingError } from "@peppol/utils/util";

export type AccessPointProviderId = (typeof accessPointProviderIds)[number];
export type SmpProviderId = (typeof smpProviderIds)[number];

export type PeppolProviders = {
  accessPointProvider: AccessPointProviderId;
  smpProvider: SmpProviderId;
};

/**
 * The access point and SMP a company in a country is served by. The country decides:
 * French companies go through the access point and SMP that operate under the French
 * regime, every other supported country through our own. Customers never pick a
 * provider; they pick a country.
 */
export function resolveDefaultPeppolProviders(country: string): PeppolProviders {
  if (country.toUpperCase() === "FR") {
    return {
      accessPointProvider: "at-shared-ap-fr",
      smpProvider: "at-shared-smp-fr",
    };
  }
  return {
    accessPointProvider: "recommand-ap1",
    smpProvider: "recommand-smp1",
  };
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
 * when it takes any scheme. The French SMP registers participants under the French
 * electronic address scheme only: a SIREN or SIRET under 0002 or 0009 is refused
 * there, however valid the number is.
 */
export function getSupportedIdentifierSchemes(
  smpProvider: SmpProviderId
): readonly string[] | null {
  if (smpProvider === "at-shared-smp-fr") {
    return ["0225"];
  }
  return null;
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
