import type { Company } from "@peppol/data/companies";
import type { Finding, Issue } from "@peppol/types/intake";
import { namesMatch } from "@peppol/utils/names-match";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";

/** Every type must name its number and its sender, or the document cannot be identified. */
export function minimumEvidence(documentType: AnyDocumentType, document: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!documentType.extractDocumentNumber(document)) {
    issues.push({ code: "missing_document_number", message: "The document number is missing." });
  }
  if (!documentType.extractCounterparties(document).senderName) {
    issues.push({ code: "missing_sender", message: "The name of the sender is missing." });
  }
  return issues;
}

/**
 * The receiver the document names must be the company that received it. For a
 * self-billing document the buyer is the sender, which the type's counterparties take
 * care of.
 */
export function receiverCheck(
  documentType: AnyDocumentType,
  document: unknown,
  company: Pick<Company, "name">,
): Finding[] {
  const { receiverName } = documentType.extractCounterparties(document);
  if (!receiverName || namesMatch(receiverName, company.name)) {
    return [];
  }
  return [
    {
      code: "receiver_mismatch",
      severity: "warning",
      scope: "business",
      message: `The document is addressed to ${receiverName}, not to ${company.name}.`,
    },
  ];
}
