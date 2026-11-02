import { UserFacingError } from "@peppol/utils/util";
import { getNullableTextContent } from "./xml-helpers";
import type { Party } from "./invoice/schemas";

// A party's VAT identifier (BT-31, BT-48) and the seller's tax registration
// identifier (BT-32) share one element: UBL tells them apart by the tax scheme
// (VAT or anything else), CII by the schemeID (VA or FC). EN 16931 has no tax
// registration identifier for the buyer, so it is neither written nor read there.

export type PartyRole = "seller" | "buyer";

export function assertTaxRegistration(document: { buyer: Party }) {
  if (document.buyer.taxRegistrationId) {
    throw new UserFacingError(
      "Only the seller can have a tax registration identifier (BT-32)."
    );
  }
}

function taxRegistrationId(party: Party, role: PartyRole) {
  return role === "seller" ? party.taxRegistrationId : null;
}

export function partyTaxSchemesToUBL(party: Party, role: PartyRole) {
  const registration = taxRegistrationId(party, role);
  const taxSchemes = [
    ...(party.vatNumber ? [{ companyId: party.vatNumber, scheme: "VAT" }] : []),
    ...(registration ? [{ companyId: registration, scheme: "TAX" }] : []),
  ];
  if (taxSchemes.length === 0) return {};
  return {
    "cac:PartyTaxScheme": taxSchemes.map(({ companyId, scheme }) => ({
      "cbc:CompanyID": companyId,
      "cac:TaxScheme": {
        "cbc:ID": scheme,
      },
    })),
  };
}

export function taxRegistrationsToCII(party: Party, role: PartyRole) {
  const registration = taxRegistrationId(party, role);
  const registrations = [
    ...(party.vatNumber ? [{ "@_schemeID": "VA", "#text": party.vatNumber }] : []),
    ...(registration ? [{ "@_schemeID": "FC", "#text": registration }] : []),
  ];
  if (registrations.length === 0) return {};
  return {
    "ram:SpecifiedTaxRegistration": registrations.map((id) => ({ "ram:ID": id })),
  };
}

function asArray(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type TaxRegistration = { vatNumber: string | null; taxRegistrationId?: string };

function withTaxRegistrationId(
  role: PartyRole,
  vatNumber: string | null,
  taxRegistrationId: string | null
): TaxRegistration {
  return { vatNumber, ...(role === "seller" && taxRegistrationId && { taxRegistrationId }) };
}

// A tax scheme without an ID is read as VAT, as before tax registration
// identifiers were read.
export function parseUblTaxRegistration(party: any, role: PartyRole): TaxRegistration {
  const taxSchemes = asArray(party?.PartyTaxScheme);
  const isVat = (taxScheme: any) => {
    const scheme = getNullableTextContent(taxScheme?.TaxScheme?.ID);
    return !scheme || scheme.trim() === "VAT";
  };
  return withTaxRegistrationId(
    role,
    getNullableTextContent(taxSchemes.find(isVat)?.CompanyID),
    getNullableTextContent(taxSchemes.find((taxScheme) => !isVat(taxScheme))?.CompanyID)
  );
}

export function parseCiiTaxRegistration(tradeParty: any, role: PartyRole): TaxRegistration {
  const ids = asArray(tradeParty?.SpecifiedTaxRegistration).map((registration) => registration?.ID);
  const isTaxNumber = (id: any) => getNullableTextContent(id?.["@_schemeID"])?.trim() === "FC";
  return withTaxRegistrationId(
    role,
    getNullableTextContent(ids.find((id) => !isTaxNumber(id))),
    getNullableTextContent(ids.find(isTaxNumber))
  );
}
