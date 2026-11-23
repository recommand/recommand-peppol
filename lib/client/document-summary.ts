/**
 * What the tables show of a parsed document: who sent it, who receives it and its
 * number. It mirrors `extractCounterparties` and `extractDocumentNumber` of the document
 * type registry, which client bundles cannot import.
 */
const PARTY_FIELDS: Record<string, { sender: string; receiver: string }> = {
  invoice: { sender: "seller", receiver: "buyer" },
  creditNote: { sender: "seller", receiver: "buyer" },
  // Self-billing reverses the roles: the buyer issues the document.
  selfBillingInvoice: { sender: "buyer", receiver: "seller" },
  selfBillingCreditNote: { sender: "buyer", receiver: "seller" },
  order: { sender: "buyer", receiver: "seller" },
  orderResponse: { sender: "seller", receiver: "buyer" },
  despatchAdvice: { sender: "despatchParty", receiver: "consignee" },
};

export type DocumentPartyInfo = {
  name: string;
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  postalZone?: string | null;
  country?: string | null;
  vatNumber?: string | null;
};

function party(parsed: unknown, field: string | undefined): DocumentPartyInfo | null {
  if (!field || !parsed || typeof parsed !== "object") return null;
  const value = (parsed as Record<string, unknown>)[field];
  if (!value || typeof value !== "object" || !("name" in value) || !value.name) return null;
  return value as DocumentPartyInfo;
}

export function getDocumentSenderParty(type: string, parsed: unknown): DocumentPartyInfo | null {
  return party(parsed, PARTY_FIELDS[type]?.sender);
}

export function getDocumentReceiverParty(type: string, parsed: unknown): DocumentPartyInfo | null {
  return party(parsed, PARTY_FIELDS[type]?.receiver);
}

const NUMBER_FIELDS = [
  "invoiceNumber",
  "creditNoteNumber",
  "selfBillingInvoiceNumber",
  "selfBillingCreditNoteNumber",
  "orderNumber",
  "orderResponseNumber",
  "despatchAdviceNumber",
] as const;

/** The number a parsed business document carries, whichever type it is. */
export function getDocumentNumber(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  for (const field of NUMBER_FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}
