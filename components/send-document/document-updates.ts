import type { Party } from "@peppol/utils/parsing/invoice/schemas";
import type { SendDocument } from "@peppol/utils/parsing/send-document";

// The send-document page holds one copy of the document being edited. Every
// part of the form changes it with an updater that receives the latest state,
// never with a copy of the document taken at render time. A write built from
// such a copy replaces whatever changed since that render, which is how a
// keystroke, or a field filled in by a request that just returned, got lost.

export type Updater<T> = (prev: T) => T;

export type DocumentDraft = Record<string, any>;

function asDraft(document: SendDocument["document"] | undefined): DocumentDraft {
  return document && typeof document === "object" ? (document as DocumentDraft) : {};
}

/** Lifts an update of the structured document to an update of the whole form. */
export function updateFormDocument(
  update: Updater<DocumentDraft>
): Updater<Partial<SendDocument>> {
  // A draft does not satisfy any one document type's schema yet.
  return (prev) =>
    ({ ...prev, document: update(asDraft(prev.document)) }) as Partial<SendDocument>;
}

export function setDocumentField(field: string, value: unknown): Updater<DocumentDraft> {
  return (prev) => ({ ...prev, [field]: value });
}

/**
 * Fills in the selected customer as the counterparty. A document that already
 * names that customer is returned unchanged, so selecting the same customer
 * again does not overwrite edits made to its details.
 */
export function applyCustomerParty(
  key: "buyer" | "seller",
  customer: Party
): Updater<DocumentDraft> {
  return (prev) => {
    const current = prev[key];
    if (
      current?.name === customer.name &&
      current?.street === customer.street &&
      current?.postalZone === customer.postalZone &&
      current?.country === customer.country
    ) {
      return prev;
    }
    return { ...prev, [key]: customer };
  };
}
