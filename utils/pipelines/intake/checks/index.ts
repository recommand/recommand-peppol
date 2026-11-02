import type { Company } from "@peppol/data/companies";
import type { Finding, Issue } from "@peppol/types/intake";
import type {
  AnyDocumentType,
  DocumentTypeClass,
} from "@peppol/utils/type-repository/document-types/types";
import { billingMinimumEvidence, billingTotalsCheck } from "./billing";
import { minimumEvidence, receiverCheck } from "./common";

type ClassChecks = {
  minimumEvidence: (document: unknown) => Issue[];
  findings: (document: unknown) => Finding[];
};

// Checks that apply to every type of a class. They read the class's shared fields only.
const CLASS_CHECKS: Partial<Record<DocumentTypeClass, ClassChecks>> = {
  billing: { minimumEvidence: billingMinimumEvidence, findings: billingTotalsCheck },
};

/** What an extracted document must contain to be published; empty when it is enough. */
export function minimumEvidenceIssues(documentType: AnyDocumentType, document: unknown): Issue[] {
  return [
    ...minimumEvidence(documentType, document),
    ...(CLASS_CHECKS[documentType.class]?.minimumEvidence(document) ?? []),
  ];
}

/** The findings of the checks: remarks that do not stop publication. */
export function checkFindings(
  documentType: AnyDocumentType,
  document: unknown,
  company: Pick<Company, "name">,
): Finding[] {
  return [
    ...receiverCheck(documentType, document, company),
    ...(CLASS_CHECKS[documentType.class]?.findings(document) ?? []),
  ];
}
