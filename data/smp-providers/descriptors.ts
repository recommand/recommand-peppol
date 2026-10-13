import type { smpProviderIds } from "@peppol/db/schema";
import { isElmaEnabled } from "@peppol/data/elma/config";

export type SmpProviderId = (typeof smpProviderIds)[number];

/**
 * What an SMP can do, as far as code outside its adapter has to know. How it
 * registers a participant, and whether it publishes to the SML and the Peppol
 * Directory itself, stays inside the adapter.
 */
export type SmpProviderDescriptor = {
  /** The identifier schemes it registers participants under, or null for any scheme. */
  identifierSchemes: readonly string[] | null;
  /**
   * Whether it hands participants to other SMPs, and takes them over from them, with
   * Peppol SML migration keys.
   */
  migrationKeys: boolean;
  /**
   * Whether its registration carries the company's name and contact details and has
   * to be published again when they change.
   */
  republishOnCompanyDetailsChange: boolean;
  /** Whether new companies may be placed on it on the given network. */
  isAvailable(useTestNetwork: boolean): boolean;
};

export const smpProviderDescriptors: Record<SmpProviderId, SmpProviderDescriptor> = {
  // Our own phoss SMP.
  "recommand-smp1": {
    identifierSchemes: null,
    migrationKeys: true,
    republishOnCompanyDetailsChange: false,
    isAvailable: () => true,
  },
  // The SMP of our French partner platform, which registers participants under the
  // French electronic address scheme only: a SIREN or SIRET under 0002 or 0009 is
  // refused there, however valid the number is.
  "at-shared-smp-fr": {
    identifierSchemes: ["0225"],
    migrationKeys: false,
    republishOnCompanyDetailsChange: false,
    isAvailable: () => true,
  },
  // ELMA, the Norwegian receiver register. It registers organisation numbers only,
  // moves participants between service providers with its own transfer rather than
  // SML migration keys, and requires the participant's contact details to be kept
  // current.
  "elma-smp-no": {
    identifierSchemes: ["0192"],
    migrationKeys: false,
    republishOnCompanyDetailsChange: true,
    isAvailable: isElmaEnabled,
  },
};

export function getSmpProviderDescriptor(provider: SmpProviderId): SmpProviderDescriptor {
  return smpProviderDescriptors[provider];
}
