import type { Company } from "@peppol/data/companies";
import type { Discrepancy, Finding, Issue } from "@peppol/types/intake";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { isUnitCode, normalizeExtractedDocument } from "../normalize";
import { minimumEvidence, receiverCheck } from "./common";

export { ambiguousDateFindings } from "./dates";

// The checks of a document. The pipeline knows no document type: what a type adds, it
// declares on its definition (`aiIntake` and `checkConsistency`).

/** An extracted document after the normalization for every type and for its own type. */
export function normalizeExtraction(documentType: AnyDocumentType, document: unknown): unknown {
  const normalized = normalizeExtractedDocument(document);
  return documentType.aiIntake?.normalize?.(normalized) ?? normalized;
}

/** The extraction rules of the type. */
export function typeInstructions(documentType: AnyDocumentType): string[] {
  return documentType.aiIntake?.instructions ?? [];
}

/** What an extracted document must contain to be published; empty when it is enough. */
export function minimumEvidenceIssues(documentType: AnyDocumentType, document: unknown): Issue[] {
  return [...minimumEvidence(documentType, document), ...(documentType.aiIntake?.minimumEvidence?.(document) ?? [])];
}

/** A parsed extracted document with the values that the type corrects, and a finding for each correction. */
export function reconcileExtraction(
  documentType: AnyDocumentType,
  document: unknown,
): { document: unknown; findings: Finding[] } {
  return documentType.aiIntake?.reconcile?.(document) ?? { document, findings: [] };
}

/** The values a parsed document states that its own other values contradict. */
export function discrepancies(documentType: AnyDocumentType, document: unknown): Discrepancy[] {
  return documentType.checkConsistency?.(document) ?? [];
}

/** A discrepancy or issue as it is shown to the model that wrote the document. */
export function repairHint(problem: Discrepancy | Issue): string {
  return `${problem.pointer ?? "document"}: ${problem.message}`;
}

function unitCodeIssues(value: unknown, pointer = ""): Issue[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unitCodeIssues(item, `${pointer}/${index}`));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) =>
    key === "unitCode" && typeof item === "string" && item !== "" && !isUnitCode(item)
      ? [
          {
            code: "invalid_unit_code",
            message: `${item} is not a UN/ECE Recommendation 20 unit code.`,
            pointer: `${pointer}/${key}`,
          },
        ]
      : unitCodeIssues(item, `${pointer}/${key}`),
  );
}

/**
 * Values of a parsed extracted document that its schema accepts but that are wrong: a
 * unit that is not a unit code, and what the type declares (`aiIntake.issues`). `text`
 * is the text layer of the PDF, when it has one.
 */
export function extractionIssues(documentType: AnyDocumentType, document: unknown, text?: string): Issue[] {
  return [...unitCodeIssues(document), ...(documentType.aiIntake?.issues?.(document, { text }) ?? [])];
}

/** An issue that the model did not correct, as a finding of the published document. */
export function issueFinding(issue: Issue): Finding {
  return {
    code: issue.code,
    severity: "warning",
    scope: "extraction",
    message: issue.message,
    pointer: `/content${issue.pointer ?? ""}`,
  };
}

/** The findings of the checks: remarks that do not stop publication. */
export function checkFindings(
  documentType: AnyDocumentType,
  document: unknown,
  company: Pick<Company, "name">,
): Finding[] {
  return [
    ...receiverCheck(documentType, document, company),
    ...discrepancies(documentType, document).map(
      (discrepancy): Finding => ({
        code: "inconsistent_amounts",
        severity: "warning",
        scope: "business",
        message: discrepancy.message,
        pointer: `/content${discrepancy.pointer}`,
      }),
    ),
  ];
}
