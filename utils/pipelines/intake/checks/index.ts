import type { Company } from "@peppol/data/companies";
import type { Finding, Issue } from "@peppol/types/intake";
import type {
  AnyDocumentType,
  DocumentTypeClass,
} from "@peppol/utils/type-repository/document-types/types";
import { normalizeExtractedDocument } from "../normalize";
import { BILLING_INSTRUCTIONS, billingMinimumEvidence, billingNormalize, billingTotalsCheck } from "./billing";
import { minimumEvidence, receiverCheck } from "./common";

type ClassChecks = {
  minimumEvidence: (document: unknown) => Issue[];
  findings: (document: unknown) => Finding[];
  /** Write an extracted document of the class in the form that its formats require. */
  normalize?: (document: unknown) => unknown;
  /** Extraction rules for the model, next to the rules for every type. */
  instructions?: string[];
};

// Checks that apply to every type of a class. They read the class's shared fields only.
const CLASS_CHECKS: Partial<Record<DocumentTypeClass, ClassChecks>> = {
  billing: {
    minimumEvidence: billingMinimumEvidence,
    findings: billingTotalsCheck,
    normalize: billingNormalize,
    instructions: BILLING_INSTRUCTIONS,
  },
};

/** An extracted document after the normalization for every type and for its class. */
export function normalizeExtraction(documentType: AnyDocumentType, document: unknown): unknown {
  const normalized = normalizeExtractedDocument(document);
  return CLASS_CHECKS[documentType.class]?.normalize?.(normalized) ?? normalized;
}

/** The extraction rules of the type's class. */
export function classInstructions(documentType: AnyDocumentType): string[] {
  return CLASS_CHECKS[documentType.class]?.instructions ?? [];
}

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
