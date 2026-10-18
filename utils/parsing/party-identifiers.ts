import { UserFacingError } from "@peppol/utils/util";
import { getNullableTextContent } from "./xml-helpers";
import type { Party, PartyIdentifier } from "./invoice/schemas";

// EN 16931 allows several seller identifiers (BT-29) but one buyer identifier
// (BT-46): UBL-SR-16 and CII-SR-450.
export function assertPartyIdentifiers(document: { buyer: Party }) {
  if ((document.buyer.partyIdentifiers?.length ?? 0) > 1) {
    throw new UserFacingError(
      "The buyer can have at most one party identifier (BT-46)."
    );
  }
}

export function partyIdentifiersToUBL(party: Party) {
  if (!party.partyIdentifiers?.length) return {};
  return {
    "cac:PartyIdentification": party.partyIdentifiers.map((partyIdentifier) => ({
      "cbc:ID": {
        ...(partyIdentifier.scheme && { "@_schemeID": partyIdentifier.scheme }),
        "#text": partyIdentifier.identifier,
      },
    })),
  };
}

function asArray(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseIdentifier(value: any): PartyIdentifier | null {
  const identifier = getNullableTextContent(value);
  if (!identifier) return null;
  return {
    identifier,
    scheme: getNullableTextContent(value?.["@_schemeID"]),
  };
}

function presentIdentifiers(values: any[]): PartyIdentifier[] | undefined {
  const identifiers = values
    .map(parseIdentifier)
    .filter((identifier): identifier is PartyIdentifier => identifier !== null);
  return identifiers.length > 0 ? identifiers : undefined;
}

export function parseUblPartyIdentifiers(party: any): PartyIdentifier[] | undefined {
  return presentIdentifiers(
    asArray(party?.PartyIdentification).map((identification) => identification?.ID)
  );
}

// CII carries an identifier without a scheme in ram:ID and one with a scheme in
// ram:GlobalID, whose schemeID is mandatory (CII-SR-046).
export function partyIdentifiersToCII(party: Party) {
  const identifiers = party.partyIdentifiers ?? [];
  const withoutScheme = identifiers.filter((identifier) => !identifier.scheme);
  const withScheme = identifiers.filter((identifier) => identifier.scheme);
  return {
    ...(withoutScheme.length > 0 && {
      "ram:ID": withoutScheme.map((identifier) => identifier.identifier),
    }),
    ...(withScheme.length > 0 && {
      "ram:GlobalID": withScheme.map((identifier) => ({
        "@_schemeID": identifier.scheme,
        "#text": identifier.identifier,
      })),
    }),
  };
}

export function parseCiiPartyIdentifiers(tradeParty: any): PartyIdentifier[] | undefined {
  return presentIdentifiers([
    ...asArray(tradeParty?.ID),
    ...asArray(tradeParty?.GlobalID),
  ]);
}
