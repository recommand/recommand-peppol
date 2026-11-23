import type { Company } from "@peppol/data/companies";
import type { AddressableParty } from "@peppol/utils/identifiers/electronic-address";
import type { PartyIdentifier } from "@peppol/utils/parsing/invoice/schemas";
import { cleanEnterpriseNumber } from "@peppol/utils/util";

/**
 * A company's enterprise number as a party identifier, for the documents that identify
 * a party by identifiers alone (order response, despatch advice). Like the party an
 * invoice defaults from the company, it is left out when the company has no scheme for
 * the number.
 */
export function companyIdentifiers(company: Company): PartyIdentifier[] | null {
  const identifier = cleanEnterpriseNumber(company.enterpriseNumber);
  const scheme = company.enterpriseNumberScheme;
  return identifier && scheme ? [{ identifier, scheme }] : null;
}

/**
 * A party identified by identifiers alone, read for its electronic address: the first
 * identifier with a scheme stands in for an enterprise number.
 */
export function identifiedParty(
  identifiers: PartyIdentifier[] | null | undefined,
): AddressableParty {
  const identifier = identifiers?.find((candidate) => candidate.scheme);
  return identifier
    ? { enterpriseNumber: identifier.identifier, enterpriseNumberScheme: identifier.scheme }
    : null;
}
