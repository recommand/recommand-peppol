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
