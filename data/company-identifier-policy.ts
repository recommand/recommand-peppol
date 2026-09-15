import { UserFacingError } from "@directory/utils/util";
import { shouldInteractWithPeppolNetwork } from "@peppol/utils/playground";
import {
  describeUnsupportedIdentifierSchemes,
  getSupportedIdentifierSchemes,
  type SmpProviderId,
} from "./peppol-providers";

/** What decides which identifier schemes a company may carry. */
export type IdentifierPolicySubject = {
  smpProvider: SmpProviderId;
  isPlayground?: boolean | null;
  useTestNetwork?: boolean | null;
};

/**
 * The schemes a company can register identifiers under, or null when any scheme
 * goes. The restriction comes from the SMP the company is registered with, so it
 * applies wherever that SMP is reached: on the production network and on the test
 * network alike, for send-only companies as much as for recipients, since the sender
 * address travels through the same provider. A playground that only simulates the
 * network never reaches the SMP, so nothing restricts it.
 */
export function getCompanyIdentifierSchemeOptions(
  subject: IdentifierPolicySubject
): readonly string[] | null {
  if (!shouldInteractWithPeppolNetwork(subject)) {
    return null;
  }
  return getSupportedIdentifierSchemes(subject.smpProvider);
}

export function findUnsupportedIdentifiers<T extends { scheme: string }>(
  subject: IdentifierPolicySubject,
  identifiers: readonly T[]
): T[] {
  const supported = getCompanyIdentifierSchemeOptions(subject);
  if (supported === null) {
    return [];
  }
  return identifiers.filter((identifier) => !supported.includes(identifier.scheme));
}

export function assertIdentifierSchemeAllowed(
  subject: IdentifierPolicySubject,
  scheme: string
): void {
  if (findUnsupportedIdentifiers(subject, [{ scheme }]).length > 0) {
    throw new UserFacingError(describeUnsupportedIdentifierSchemes(subject.smpProvider, [scheme]));
  }
}

/**
 * Refuses a set of identifiers that the company's SMP would not register, naming
 * each offending address so the customer knows what to remove. Used before anything
 * that would build on those identifiers: a verification, a mandate, a registration.
 */
export function assertIdentifiersAllowed(
  subject: IdentifierPolicySubject,
  identifiers: readonly { scheme: string; identifier: string }[]
): void {
  const unsupported = findUnsupportedIdentifiers(subject, identifiers);
  if (unsupported.length === 0) {
    return;
  }
  throw new UserFacingError(
    describeUnsupportedIdentifierSchemes(subject.smpProvider, unsupported.map((identifier) => identifier.scheme)) +
      ` Remove or change ${unsupported.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(", ")} before continuing.`
  );
}
