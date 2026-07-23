import { XMLParser } from "fast-xml-parser";
import { getNullableTextContent, getTextContent } from "../xml-helpers";
import { parsePeppolAddress } from "../peppol-address";
import {
  franceCdarSchema,
  type FranceCdar,
  type FranceCdarCollectedAmount,
} from "./schemas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    name === "AcknowledgementDocument" ||
    name === "ReferenceReferencedDocument" ||
    name === "SpecifiedDocumentStatus" ||
    name === "IncludedNote" ||
    name === "SpecifiedDocumentCharacteristic" ||
    name === "GlobalID" ||
    name === "RecipientTradeParty",
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function dateOrDateTime(value: unknown, field: string): string {
  const dateTimeString = (
    value as { DateTimeString?: unknown } | null | undefined
  )?.DateTimeString;
  const format = getTextContent(
    (dateTimeString as { "@_format"?: unknown } | null | undefined)?.[
      "@_format"
    ]
  );
  const text = getTextContent(dateTimeString);

  if (format === "102") {
    if (!/^\d{8}$/.test(text)) {
      throw new Error(
        `Invalid XML: ${field} DateTimeString format 102 must contain YYYYMMDD`
      );
    }
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  if (format === "204") {
    if (!/^\d{14}$/.test(text)) {
      throw new Error(
        `Invalid XML: ${field} DateTimeString format 204 must contain YYYYMMDDHHMMSS`
      );
    }
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(
      6,
      8
    )}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
  }

  throw new Error(
    `Invalid XML: ${field} DateTimeString format must be 102 or 204`
  );
}

function nullableDateTime(value: unknown, field: string): string | undefined {
  if (!value) return undefined;
  return dateOrDateTime(value, field);
}

function nullableDate(value: unknown, field: string): string | undefined {
  if (!value) return undefined;
  const parsedDate = dateOrDateTime(value, field);
  return parsedDate ? parsedDate.slice(0, 10) : undefined;
}

function partyLegalId(
  party: any
): { identifier: string; scheme: string } {
  const globalId = first(party?.GlobalID);
  if (globalId) {
    return {
      identifier: getTextContent(globalId["#text"] ?? globalId),
      scheme: getTextContent(globalId?.["@_schemeID"]),
    };
  }
  const legalOrgId = party?.SpecifiedLegalOrganization?.ID;
  if (legalOrgId) {
    return {
      identifier: getTextContent(legalOrgId["#text"] ?? legalOrgId),
      scheme: getTextContent(legalOrgId?.["@_schemeID"]),
    };
  }
  return {
    identifier: getTextContent(party?.ID),
    scheme: getTextContent(party?.ID?.["@_schemeID"]),
  };
}

function nullablePartyLegalId(
  party: any
): { identifier: string; scheme: string } | undefined {
  if (!party) return undefined;
  const legalId = partyLegalId(party);
  return legalId.identifier || legalId.scheme ? legalId : undefined;
}

function getCdarRoot(parsed: any): any {
  if (parsed.CrossDomainAcknowledgementAndResponse) {
    return parsed.CrossDomainAcknowledgementAndResponse;
  }
  if (parsed.StandardBusinessDocument?.CrossDomainAcknowledgementAndResponse) {
    return parsed.StandardBusinessDocument.CrossDomainAcknowledgementAndResponse;
  }
  return null;
}

export function parseFranceCdarFromXML(xml: string): FranceCdar {
  const parsed = parser.parse(xml);
  const cdar = getCdarRoot(parsed);
  if (!cdar) {
    throw new Error("Invalid XML: No CrossDomainAcknowledgementAndResponse element found");
  }

  const exchangedDocument = cdar.ExchangedDocument;
  const exchangedDocumentContext = cdar.ExchangedDocumentContext;
  const acknowledgement = first(cdar.AcknowledgementDocument);
  const referencedDocument = first(acknowledgement?.ReferenceReferencedDocument);
  if (!referencedDocument) {
    throw new Error("Invalid XML: No ReferenceReferencedDocument element found");
  }

  const projectedStatusDetail = first(
    referencedDocument.SpecifiedDocumentStatus
  );
  const reasonCode =
    getNullableTextContent(projectedStatusDetail?.ReasonCode) ?? undefined;
  const reason =
    getNullableTextContent(first(projectedStatusDetail?.Reason)) ?? undefined;
  const reasonNote =
    getNullableTextContent(
      first(first(projectedStatusDetail?.IncludedNote)?.Content)
    ) ?? undefined;
  const collectedAmounts: FranceCdarCollectedAmount[] = [];

  for (const characteristic of asArray(
    projectedStatusDetail?.SpecifiedDocumentCharacteristic
  )) {
    if (getTextContent(characteristic?.TypeCode) !== "MEN") continue;
    const valueAmount = characteristic?.ValueAmount;
    const amount = getTextContent(valueAmount);
    const currency = getTextContent(valueAmount?.["@_currencyID"]);
    const vatPercent = getTextContent(characteristic?.ValuePercent);
    collectedAmounts.push({ amount, currency, vatPercent });
  }

  const recipient = first(exchangedDocument?.RecipientTradeParty);
  const issuer = exchangedDocument?.IssuerTradeParty;
  const issuerLegalId = nullablePartyLegalId(issuer);
  const sellerLegalId = nullablePartyLegalId(referencedDocument.IssuerTradeParty);
  const recipientLegalId = nullablePartyLegalId(recipient);
  const recipientUriId = recipient?.URIUniversalCommunication?.URIID;
  let recipientElectronicAddress =
    getNullableTextContent(recipientUriId) ?? undefined;
  let recipientElectronicAddressScheme =
    getNullableTextContent(recipientUriId?.["@_schemeID"]) ?? undefined;
  const hasCombinedAddress =
    !recipientElectronicAddressScheme &&
    /^\d{4}:[^:]+$/.test(recipientElectronicAddress ?? "");
  if (hasCombinedAddress) {
    // Arratech incorrectly copies the combined SBDH participant identifier into
    // URIID instead of putting its scheme in URIID/@schemeID.
    const parsedAddress = parsePeppolAddress(recipientElectronicAddress!);
    recipientElectronicAddressScheme = parsedAddress.schemeId;
    recipientElectronicAddress = parsedAddress.identifier;
  }
  const invoiceIssueDate = nullableDate(
    referencedDocument.FormattedIssueDateTime,
    "FormattedIssueDateTime"
  );
  const invoiceTypeCode =
    getNullableTextContent(referencedDocument.TypeCode) ?? undefined;
  // The status date is mandatory, but fall back to the CDAR creation date so a
  // non-conformant document still parses instead of failing as a whole.
  const statusDate =
    nullableDateTime(
      acknowledgement?.IssueDateTime,
      "AcknowledgementDocument IssueDateTime"
    ) ?? dateOrDateTime(exchangedDocument?.IssueDateTime, "IssueDateTime");

  return franceCdarSchema.parse({
    id: getTextContent(exchangedDocument?.ID),
    issueDate: dateOrDateTime(exchangedDocument?.IssueDateTime, "IssueDateTime"),
    businessProcess: getTextContent(
      exchangedDocumentContext?.BusinessProcessSpecifiedDocumentContextParameter?.ID
    ),
    phase: getTextContent(acknowledgement?.TypeCode),
    senderRole: getTextContent(exchangedDocument?.SenderTradeParty?.RoleCode),
    issuerRole: getTextContent(issuer?.RoleCode),
    ...(issuerLegalId
      ? {
          issuerLegalId: issuerLegalId.identifier,
          issuerLegalIdScheme: issuerLegalId.scheme,
        }
      : {}),
    recipientRole: getTextContent(recipient?.RoleCode),
    ...(recipientLegalId
      ? {
          recipientLegalId: recipientLegalId.identifier,
          recipientLegalIdScheme: recipientLegalId.scheme,
        }
      : {}),
    ...(recipientElectronicAddress || recipientElectronicAddressScheme
      ? {
          recipientElectronicAddress,
          recipientElectronicAddressScheme,
        }
      : {}),
    statusCode: getTextContent(referencedDocument.ProcessConditionCode),
    statusDate,
    invoiceId: getTextContent(referencedDocument.IssuerAssignedID),
    ...(invoiceTypeCode ? { invoiceTypeCode } : {}),
    ...(invoiceIssueDate ? { invoiceIssueDate } : {}),
    ...(sellerLegalId
      ? {
          sellerLegalId: sellerLegalId.identifier,
          sellerLegalIdScheme: sellerLegalId.scheme,
        }
      : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(reason ? { reason } : {}),
    ...(reasonNote ? { reasonNote } : {}),
    ...(collectedAmounts.length > 0 ? { collectedAmounts } : {}),
  });
}
