import type { Attachment, PartyIdentifier, Period } from "./invoice/schemas";
import { getNullableTextContent, getTextContent } from "./xml-helpers";

/**
 * UBL building blocks shared by the Peppol BIS 3 post-award transactions (order, order
 * response, despatch advice). Their syntax differs from Peppol BIS Billing in small ways
 * that matter to a validator, such as `cbc:DocumentType` where an invoice has
 * `cbc:DocumentDescription`, so they do not reuse the billing writers.
 *
 * Every writer emits its elements in the order the UBL 2.1 schema declares them.
 */

export type PostalAddress = {
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  postalZone?: string | null;
  country: string;
};

export function asArray<T = any>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function amount(currency: string, value: string) {
  return { "@_currencyID": currency, "#text": value };
}

export function quantity(unitCode: string, value: string) {
  return { "@_unitCode": unitCode, "#text": value };
}

export function identifier(value: PartyIdentifier) {
  return {
    ...(value.scheme && { "@_schemeID": value.scheme }),
    "#text": value.identifier,
  };
}

export function parseIdentifier(value: any): PartyIdentifier | null {
  const text = getNullableTextContent(value);
  if (!text) return null;
  return { identifier: text, scheme: getNullableTextContent(value?.["@_schemeID"]) };
}

export function addressToUBL(address: PostalAddress) {
  return {
    ...(address.street && { "cbc:StreetName": address.street }),
    ...(address.street2 && { "cbc:AdditionalStreetName": address.street2 }),
    ...(address.city && { "cbc:CityName": address.city }),
    ...(address.postalZone && { "cbc:PostalZone": address.postalZone }),
    "cac:Country": { "cbc:IdentificationCode": address.country },
  };
}

/** A postal address, or undefined when the element names no country, which UBL requires. */
export function parseAddress(address: any): PostalAddress | undefined {
  const country = getNullableTextContent(address?.Country?.IdentificationCode);
  if (!country) return undefined;
  return {
    street: getNullableTextContent(address.StreetName),
    street2: getNullableTextContent(address.AdditionalStreetName),
    city: getNullableTextContent(address.CityName),
    postalZone: getNullableTextContent(address.PostalZone),
    country,
  };
}

export function periodToUBL(period: Period) {
  return {
    ...(period.startDate && { "cbc:StartDate": period.startDate }),
    ...(period.endDate && { "cbc:EndDate": period.endDate }),
  };
}

export function parsePeriod(period: any): Period | null {
  const startDate = getNullableTextContent(period?.StartDate);
  const endDate = getNullableTextContent(period?.EndDate);
  if (!startDate && !endDate) return null;
  return { startDate, endDate };
}

export function contactToUBL(party: { name?: string | null; email?: string | null; phone?: string | null }) {
  if (!party.email && !party.phone) return {};
  return {
    "cac:Contact": {
      ...(party.name && { "cbc:Name": party.name }),
      ...(party.phone && { "cbc:Telephone": party.phone }),
      ...(party.email && { "cbc:ElectronicMail": party.email }),
    },
  };
}

/**
 * `cac:AdditionalDocumentReference` as the post-award transactions write it: the
 * attachment's description goes in `cbc:DocumentType`.
 */
export function attachmentsToUBL(attachments: Attachment[] | null | undefined) {
  if (!attachments?.length) return {};
  return {
    "cac:AdditionalDocumentReference": attachments.map((attachment) => ({
      "cbc:ID": attachment.id,
      ...(attachment.description && { "cbc:DocumentType": attachment.description }),
      ...((attachment.embeddedDocument || attachment.url) && {
        "cac:Attachment": {
          ...(attachment.embeddedDocument && {
            "cbc:EmbeddedDocumentBinaryObject": {
              "@_mimeCode": attachment.mimeCode,
              "@_filename": attachment.filename,
              "#text": attachment.embeddedDocument,
            },
          }),
          ...(attachment.url && {
            "cac:ExternalReference": { "cbc:URI": attachment.url },
          }),
        },
      }),
    })),
  };
}

export function parseAttachments(references: any): Attachment[] {
  return asArray(references).map((reference: any) => {
    const embedded = reference.Attachment?.EmbeddedDocumentBinaryObject;
    return {
      id: getTextContent(reference.ID),
      description: getNullableTextContent(reference.DocumentType ?? reference.DocumentDescription),
      mimeCode: getNullableTextContent(embedded?.["@_mimeCode"]) ?? "application/pdf",
      filename: getTextContent(embedded?.["@_filename"]),
      embeddedDocument: getNullableTextContent(embedded),
      url: getNullableTextContent(reference.Attachment?.ExternalReference?.URI),
    };
  });
}

/** The item identifiers every post-award line carries, in schema order. */
export function itemIdentifiersToUBL(item: {
  buyersId?: string | null;
  sellersId?: string | null;
  standardId?: { scheme: string; identifier: string } | null;
}) {
  return {
    ...(item.buyersId && {
      "cac:BuyersItemIdentification": { "cbc:ID": item.buyersId },
    }),
    ...(item.sellersId && {
      "cac:SellersItemIdentification": { "cbc:ID": item.sellersId },
    }),
    ...(item.standardId && {
      "cac:StandardItemIdentification": {
        "cbc:ID": {
          "@_schemeID": item.standardId.scheme,
          "#text": item.standardId.identifier,
        },
      },
    }),
  };
}

export function parseItemIdentifiers(item: any) {
  const standard = item?.StandardItemIdentification?.ID;
  return {
    buyersId: getNullableTextContent(item?.BuyersItemIdentification?.ID),
    sellersId: getNullableTextContent(item?.SellersItemIdentification?.ID),
    standardId: getNullableTextContent(standard)
      ? {
          scheme: getTextContent(standard?.["@_schemeID"]),
          identifier: getTextContent(standard),
        }
      : null,
  };
}

export function commodityClassificationsToUBL(
  classifications: { scheme: string; schemeVersion?: string | null; value: string }[] | null | undefined,
) {
  if (!classifications?.length) return {};
  return {
    "cac:CommodityClassification": classifications.map((classification) => ({
      "cbc:ItemClassificationCode": {
        "@_listID": classification.scheme,
        ...(classification.schemeVersion && { "@_listVersionID": classification.schemeVersion }),
        "#text": classification.value,
      },
    })),
  };
}

export function additionalItemPropertiesToUBL(
  properties: { name: string; value: string }[] | null | undefined,
) {
  if (!properties?.length) return {};
  return {
    "cac:AdditionalItemProperty": properties.map((property) => ({
      "cbc:Name": property.name,
      "cbc:Value": property.value,
    })),
  };
}

export function parseAdditionalItemProperties(properties: any) {
  return asArray(properties).map((property: any) => ({
    name: getTextContent(property.Name),
    value: getTextContent(property.Value),
  }));
}

/** The elements a fast-xml-parser instance for a post-award document should always read as lists. */
export const POST_AWARD_ARRAY_ELEMENTS = new Set([
  "AdditionalDocumentReference",
  "AllowanceCharge",
  "AdditionalItemProperty",
  "CommodityClassification",
  "PartyIdentification",
  "ItemInstance",
  "OrderLine",
  "DespatchLine",
  "OrderReference",
  "OutstandingReason",
  "Information",
]);
