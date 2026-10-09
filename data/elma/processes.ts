import { UserFacingError } from "@peppol/utils/util";
import { qualifiedIdentifierToString, type ElmaClient, type ElmaProcess } from "./client";

// A participant in ELMA is registered for processes, not for document types. An
// ELMA process is a Peppol process identifier together with the document types ELMA
// publishes for it, so a document type we register maps to the process whose
// identifier is our process ID and whose document types include ours. Registering
// that process publishes every document type it carries, which can be more than the
// company asked for: the Peppol BIS Billing process publishes both the invoice and
// the credit note.

const PROCESS_SCHEME = "cenbii-procid-ubl";
const DOCUMENT_SCHEME = "busdox-docid-qns";

type DocumentType = { docTypeId: string; processId: string };

function qualifiedProcessId(processId: string): string {
  return processId.includes("::") ? processId : `${PROCESS_SCHEME}::${processId}`;
}

function qualifiedDocumentTypeId(docTypeId: string): string {
  return `${DOCUMENT_SCHEME}::${docTypeId}`;
}

function carries(process: ElmaProcess, documentType: DocumentType): boolean {
  return (
    !process.restricted &&
    qualifiedIdentifierToString(process.qualifiedIdentifier) === qualifiedProcessId(documentType.processId) &&
    (process.documentTypes ?? []).some(
      (candidate) => qualifiedIdentifierToString(candidate.qualifiedIdentifier) === qualifiedDocumentTypeId(documentType.docTypeId)
    )
  );
}

/**
 * The ELMA process identifiers to register for the given document types. A
 * document type that no current ELMA process carries, or that more than one does,
 * is refused rather than guessed: the second case would publish the company in a
 * role (buyer or seller, for example) we cannot tell apart.
 */
export function mapDocumentTypesToElmaProcesses(
  documentTypes: readonly DocumentType[],
  catalogue: readonly ElmaProcess[]
): string[] {
  const processIds: string[] = [];
  const refused: string[] = [];
  for (const documentType of documentTypes) {
    const matches = catalogue.filter((process) => carries(process, documentType));
    if (matches.length !== 1) {
      refused.push(`${documentType.docTypeId} (process ${documentType.processId})`);
      continue;
    }
    if (!processIds.includes(matches[0].identifier)) {
      processIds.push(matches[0].identifier);
    }
  }
  if (refused.length > 0) {
    throw new UserFacingError(
      `ELMA, the Norwegian receiver register, does not offer ${refused.length === 1 ? "this document type" : "these document types"} for registration: ${refused.join(", ")}. Remove ${refused.length === 1 ? "it" : "them"} from the company's document types to register it as a receiver in Norway.`
    );
  }
  return processIds;
}

const catalogueCache = new Map<boolean, Promise<ElmaProcess[]>>();

/**
 * ELMA's processes, read once per environment and kept for the life of the
 * process: they change when the Norwegian Peppol Authority publishes a new one. A
 * failed read is not kept.
 */
export function getElmaProcessCatalogue(client: ElmaClient, useTestNetwork: boolean): Promise<ElmaProcess[]> {
  let catalogue = catalogueCache.get(useTestNetwork);
  if (!catalogue) {
    catalogue = client.listProcesses();
    catalogue.catch(() => catalogueCache.delete(useTestNetwork));
    catalogueCache.set(useTestNetwork, catalogue);
  }
  return catalogue;
}
