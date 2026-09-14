import type { accessPointProviderIds, smpProviderIds } from "@peppol/db/schema";

export type AccessPointProviderId = (typeof accessPointProviderIds)[number];
export type SmpProviderId = (typeof smpProviderIds)[number];

export function resolveDefaultPeppolProviders(country: string): {
  accessPointProvider: AccessPointProviderId;
  smpProvider: SmpProviderId;
} {
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
