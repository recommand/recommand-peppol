import { UserFacingError } from "@peppol/utils/util";
import { getNullableTextContent } from "./xml-helpers";
import type { Party } from "./invoice/schemas";

// A party's VAT identifier (BT-31, BT-48) and the seller's tax registration
// identifier (BT-32) share one element: UBL tells them apart by the tax scheme
// (VAT or anything else), CII by the schemeID (VA or FC). EN 16931 has no tax
// registration identifier for the buyer.

export function assertTaxRegistration(document: { buyer: Party }) {
  if (document.buyer.taxRegistrationId) {
    throw new UserFacingError(
      "Only the seller can have a tax registration identifier (BT-32)."
    );
  }
}

export function partyTaxSchemesToUBL(party: Party) {
  const taxSchemes = [
    ...(party.vatNumber ? [{ companyId: party.vatNumber, scheme: "VAT" }] : []),
    ...(party.taxRegistrationId ? [{ companyId: party.taxRegistrationId, scheme: "TAX" }] : []),
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

export function taxRegistrationsToCII(party: Party) {
  const registrations = [
    ...(party.vatNumber ? [{ "@_schemeID": "VA", "#text": party.vatNumber }] : []),
    ...(party.taxRegistrationId ? [{ "@_schemeID": "FC", "#text": party.taxRegistrationId }] : []),
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

function withTaxRegistrationId(vatNumber: string | null, taxRegistrationId: string | null): TaxRegistration {
  return { vatNumber, ...(taxRegistrationId && { taxRegistrationId }) };
}

// A tax scheme without an ID is read as VAT, as before tax registration
// identifiers were read.
export function parseUblTaxRegistration(party: any): TaxRegistration {
  const taxSchemes = asArray(party?.PartyTaxScheme);
  const isVat = (taxScheme: any) => {
    const scheme = getNullableTextContent(taxScheme?.TaxScheme?.ID);
    return !scheme || scheme.trim() === "VAT";
  };
  return withTaxRegistrationId(
    getNullableTextContent(taxSchemes.find(isVat)?.CompanyID),
    getNullableTextContent(taxSchemes.find((taxScheme) => !isVat(taxScheme))?.CompanyID)
  );
}

export function parseCiiTaxRegistration(tradeParty: any): TaxRegistration {
  const ids = asArray(tradeParty?.SpecifiedTaxRegistration).map((registration) => registration?.ID);
  const isTaxNumber = (id: any) => getNullableTextContent(id?.["@_schemeID"])?.trim() === "FC";
  return withTaxRegistrationId(
    getNullableTextContent(ids.find((id) => !isTaxNumber(id))),
    getNullableTextContent(ids.find(isTaxNumber))
  );
}
