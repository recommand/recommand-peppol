import {
  assertNorwegianOrganisationsRegistrable,
  NORWEGIAN_ORGANISATION_SCHEME,
} from "./bronnoysund/organisation-check";

// Some identifier schemes are numbers in a national register that the country's
// Peppol authority requires us to check before a participant is published, on
// whichever SMP. Each such scheme names its check here; identifiers under other
// schemes are published as they are.
//
// The requirement is about the production network. The test network is left alone:
// integrators test with synthetic organisations from their country's test data,
// which the production registers do not know.

type Identifier = { scheme: string; identifier: string };
type RegistrationCheck = (identifiers: readonly Identifier[]) => Promise<void>;

const registrationChecks: Partial<Record<string, RegistrationCheck>> = {
  [NORWEGIAN_ORGANISATION_SCHEME]: (identifiers) => assertNorwegianOrganisationsRegistrable(identifiers),
};

/**
 * Refuses identifiers that their national register says cannot be published, with
 * a UserFacingError that says why. Each check receives only the identifiers under
 * its own scheme.
 */
export async function assertIdentifiersRegistrable(
  identifiers: readonly Identifier[],
  network: { useTestNetwork: boolean },
  checks: Partial<Record<string, RegistrationCheck>> = registrationChecks
): Promise<void> {
  if (network.useTestNetwork) {
    return;
  }
  for (const [scheme, check] of Object.entries(checks)) {
    const underScheme = identifiers.filter((identifier) => identifier.scheme === scheme);
    if (check && underScheme.length > 0) {
      await check(underScheme);
    }
  }
}
