import { cleanEnterpriseNumber, cleanVatNumber, UserFacingError } from "@peppol/utils/util";
import { COUNTRIES } from "@peppol/utils/countries";
import { validateIdentifier } from "@peppol/utils/identifier-validation";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import { cleanIdentifier, cleanScheme, validateIdentifierAgainstCompany } from "./company-identifiers";
import { findUnsupportedIdentifiers } from "./company-identifier-policy";
import {
  describeUnsupportedIdentifierSchemes,
  resolveDefaultPeppolProviders,
  samePeppolProviders,
  type PeppolProviders,
} from "./peppol-providers";

export const COUNTRY_CHANGE_BLOCKED_MESSAGE =
  "The country of a company cannot be changed once its verification has started or it is registered on the Peppol network. " +
  "Create a new company for the other country, or contact support@recommand.eu if the country was entered incorrectly.";

type IdentifierRow = { id: string; scheme: string; identifier: string };
type NewIdentifier = { scheme: string; identifier: string };

export type CountryChangeInput = {
  oldCompany: {
    country: string;
    enterpriseNumber: string | null;
    vatNumber: string | null;
    enterpriseNumberScheme: string | null;
    accessPointProvider: PeppolProviders["accessPointProvider"];
    smpProvider: PeppolProviders["smpProvider"];
  };
  newCountry: string;
  /** The enterprise number and VAT number the company will have after the update. */
  enterpriseNumber: string | null;
  vatNumber: string | null;
  /** The scheme the request set for the enterprise number; undefined leaves it to the country. */
  requestedEnterpriseNumberScheme?: string | null;
  identifiers: readonly IdentifierRow[];
  teamExtension: { isPlayground?: boolean | null; useTestNetwork?: boolean | null } | null | undefined;
  /** A verification session of the company went past the empty link created with it. */
  verificationStarted: boolean;
  /** The company's identifiers are published on an SMP. */
  networkRegistered: boolean;
};

export type CountryChangePlan = {
  providers: PeppolProviders;
  providersChanged: boolean;
  /** undefined leaves the column as it is. */
  enterpriseNumberScheme: string | null | undefined;
  deleteIdentifierIds: string[];
  createIdentifiers: NewIdentifier[];
  keptIdentifiers: IdentifierRow[];
};

/**
 * The identifiers a country gives a company by default: its business register
 * number and its VAT number under the country's schemes. These are the ones a
 * country change replaces; anything else the customer added is kept and re-checked.
 */
function defaultIdentifiersFor(
  country: string,
  enterpriseNumber: string | null,
  vatNumber: string | null
): NewIdentifier[] {
  const countryInfo = COUNTRIES.find((entry) => entry.code === country);
  const defaults: NewIdentifier[] = [];
  const cleanedEnterpriseNumber = cleanEnterpriseNumber(enterpriseNumber);
  if (countryInfo?.defaultEnterpriseNumberScheme && cleanedEnterpriseNumber) {
    defaults.push({
      scheme: cleanScheme(countryInfo.defaultEnterpriseNumberScheme),
      identifier: cleanIdentifier(cleanedEnterpriseNumber),
    });
  }
  const cleanedVatNumber = cleanVatNumber(vatNumber);
  if (countryInfo?.defaultVatScheme && cleanedVatNumber) {
    defaults.push({
      scheme: cleanScheme(countryInfo.defaultVatScheme),
      identifier: cleanIdentifier(cleanedVatNumber),
    });
  }
  return defaults;
}

function defaultEnterpriseNumberSchemeFor(country: string): string | null {
  const scheme = COUNTRIES.find((entry) => entry.code === country)?.defaultEnterpriseNumberScheme ?? null;
  return scheme && zodValidIsoIcdSchemeIdentifiers.safeParse(scheme).success ? scheme : null;
}

function sameIdentifier(left: NewIdentifier, right: NewIdentifier): boolean {
  return left.scheme === right.scheme && left.identifier === right.identifier;
}

/**
 * What moving a company to another country entails, or why it cannot happen.
 *
 * The move is only open while nothing outside our database depends on the
 * company's country: no identity check or mandate was started under it and no
 * identifier of it is published on an SMP. Past that point the providers behind the
 * company differ per country and cannot be swapped without the provider's own
 * process, so the change is refused and support takes it from there.
 *
 * When it is open, the country's default identifiers are replaced with the new
 * country's, and every identifier the customer added is held against the new
 * country's providers and the company's numbers, so the company ends up in a state
 * it could have been created in.
 */
export function planCompanyCountryChange(input: CountryChangeInput): CountryChangePlan {
  if (input.verificationStarted || input.networkRegistered) {
    throw new UserFacingError(COUNTRY_CHANGE_BLOCKED_MESSAGE);
  }

  const providers = resolveDefaultPeppolProviders(input.newCountry);
  const providersChanged = !samePeppolProviders(providers, input.oldCompany);

  const oldDefaults = defaultIdentifiersFor(
    input.oldCompany.country,
    input.oldCompany.enterpriseNumber,
    input.oldCompany.vatNumber
  );
  const newDefaults = defaultIdentifiersFor(input.newCountry, input.enterpriseNumber, input.vatNumber);

  // An old default the new country would create again stays where it is.
  const deleted = input.identifiers.filter(
    (identifier) =>
      oldDefaults.some((candidate) => sameIdentifier(candidate, identifier)) &&
      !newDefaults.some((candidate) => sameIdentifier(candidate, identifier))
  );
  const keptIdentifiers = input.identifiers.filter((identifier) => !deleted.includes(identifier));
  const createIdentifiers = newDefaults.filter(
    (candidate) => !keptIdentifiers.some((identifier) => sameIdentifier(candidate, identifier))
  );

  const updatedCompany = {
    smpProvider: providers.smpProvider,
    enterpriseNumber: input.enterpriseNumber,
    vatNumber: input.vatNumber,
  };
  const unsupported = findUnsupportedIdentifiers(
    { smpProvider: providers.smpProvider, ...input.teamExtension },
    keptIdentifiers
  );
  if (unsupported.length > 0) {
    throw new UserFacingError(
      describeUnsupportedIdentifierSchemes(providers.smpProvider, unsupported.map((identifier) => identifier.scheme)) +
        ` Remove ${unsupported.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(", ")} before changing the country to ${input.newCountry}.`
    );
  }
  for (const identifier of [...keptIdentifiers, ...createIdentifiers]) {
    try {
      validateIdentifier(identifier.scheme, identifier.identifier);
      validateIdentifierAgainstCompany({
        scheme: identifier.scheme,
        identifier: identifier.identifier,
        company: updatedCompany,
        teamExtension: input.teamExtension,
      });
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw new UserFacingError(
          `Identifier ${identifier.scheme}:${identifier.identifier} is not valid for a company in ${input.newCountry}: ${error.message}`
        );
      }
      throw error;
    }
  }

  let enterpriseNumberScheme: string | null | undefined;
  if (input.requestedEnterpriseNumberScheme !== undefined) {
    enterpriseNumberScheme = input.requestedEnterpriseNumberScheme;
  } else if (
    input.oldCompany.enterpriseNumberScheme === null ||
    input.oldCompany.enterpriseNumberScheme === defaultEnterpriseNumberSchemeFor(input.oldCompany.country)
  ) {
    // The scheme followed the old country's default, so it follows the new one's.
    enterpriseNumberScheme = defaultEnterpriseNumberSchemeFor(input.newCountry);
  }

  return {
    providers,
    providersChanged,
    enterpriseNumberScheme,
    deleteIdentifierIds: deleted.map((identifier) => identifier.id),
    createIdentifiers,
    keptIdentifiers,
  };
}
