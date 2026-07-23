import { XMLParser } from "fast-xml-parser";
import { getNullableTextContent, getTextContent } from "../xml-helpers";
import { franceCdarSchema, type FranceCdar } from "./schemas";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    name === "AcknowledgementDocument" ||
    name === "ReferenceReferencedDocument" ||
    name === "SpecifiedDocumentStatus" ||
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

function date(value: unknown): string {
  const text = getTextContent(
    (value as { DateTimeString?: unknown } | null | undefined)?.DateTimeString ?? value
  );
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{14}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  return text;
}

function nullableDate(value: unknown): string | undefined {
  const parsedDate = date(value);
  return parsedDate || undefined;
}

function partyLegalId(party: any): string {
  const globalId = first(party?.GlobalID);
  if (globalId) {
    return getTextContent(globalId["#text"] ?? globalId);
  }
  const legalOrgId = party?.SpecifiedLegalOrganization?.ID;
  if (legalOrgId) {
    return getTextContent(legalOrgId["#text"] ?? legalOrgId);
  }
  return getTextContent(party?.ID);
}

function nullablePartyLegalId(party: any): string | undefined {
  if (!party) return undefined;
  const legalId = partyLegalId(party);
  return legalId || undefined;
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

  const statusDetails = asArray(referencedDocument.SpecifiedDocumentStatus);
  let reasonCode: string | undefined;
  let reason: string | undefined;
  const collectedAmounts: Array<{ amount: string; vatPercent: string }> = [];

  for (const statusDetail of statusDetails) {
    if (!reasonCode) {
      reasonCode = getNullableTextContent(statusDetail?.ReasonCode) ?? undefined;
    }
    if (!reason) {
      reason = getNullableTextContent(statusDetail?.Reason) ?? undefined;
    }

    for (const characteristic of asArray(statusDetail?.SpecifiedDocumentCharacteristic)) {
      if (getTextContent(characteristic?.TypeCode) !== "MEN") continue;
      const amount = getTextContent(characteristic?.ValueAmount);
      const vatPercent = getTextContent(characteristic?.ValuePercent);
      if (amount || vatPercent) {
        collectedAmounts.push({ amount, vatPercent });
      }
    }
  }

  const recipient = first(exchangedDocument?.RecipientTradeParty);
  const issuerLegalId = nullablePartyLegalId(exchangedDocument?.IssuerTradeParty);
  const sellerLegalId = nullablePartyLegalId(referencedDocument.IssuerTradeParty);
  const recipientLegalId = nullablePartyLegalId(recipient);
  const recipientElectronicAddress = getNullableTextContent(
    recipient?.URIUniversalCommunication?.URIID
  ) ?? undefined;
  const invoiceIssueDate = nullableDate(referencedDocument.FormattedIssueDateTime);

  return franceCdarSchema.parse({
    id: getTextContent(exchangedDocument?.ID),
    issueDate: date(exchangedDocument?.IssueDateTime),
    businessProcess: getTextContent(
      exchangedDocumentContext?.BusinessProcessSpecifiedDocumentContextParameter?.ID
    ),
    phase: getTextContent(acknowledgement?.TypeCode),
    senderRole: getTextContent(exchangedDocument?.SenderTradeParty?.RoleCode),
    ...(issuerLegalId ? { issuerLegalId } : {}),
    recipientRole: getTextContent(recipient?.RoleCode),
    ...(recipientLegalId ? { recipientLegalId } : {}),
    ...(recipientElectronicAddress ? { recipientElectronicAddress } : {}),
    statusCode: getTextContent(referencedDocument.ProcessConditionCode),
    invoiceId: getTextContent(referencedDocument.IssuerAssignedID),
    ...(invoiceIssueDate ? { invoiceIssueDate } : {}),
    ...(sellerLegalId ? { sellerLegalId } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(reason ? { reason } : {}),
    ...(collectedAmounts.length > 0 ? { collectedAmounts } : {}),
  });
}
