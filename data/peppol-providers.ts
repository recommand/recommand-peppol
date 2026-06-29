import type {
  accessPointProviderIds,
  smpProviderIds,
} from "@peppol/db/schema";

export type AccessPointProviderId = (typeof accessPointProviderIds)[number];
export type SmpProviderId = (typeof smpProviderIds)[number];

export function resolveDefaultPeppolProviders(_country: string): {
  accessPointProvider: AccessPointProviderId;
  smpProvider: SmpProviderId;
} {
  return {
    accessPointProvider: "recommand-ap1",
    smpProvider: "recommand-smp1",
  };
}
