import { addDocumentFindings, getImportResults } from "@peppol/data/imports/results";
import type { Discrepancy, Failure, Finding, Issue } from "@peppol/types/intake";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import type { z } from "zod";
import {
  ambiguousDateFindings,
  checkFindings,
  discrepancies,
  extractionIssues,
  issueFinding,
  minimumEvidenceIssues,
  normalizeExtraction,
  reconcileExtraction,
  repairHint,
} from "../checks";
import { extractWithModel, getIntakeLanguageModel } from "../models/claude";
import { MAX_REPAIR_CALLS } from "../models/config";
import { type Checkpoints, failure, type ResultContext, type Stage, type StageOutcome } from "../types";
import { withAttempt } from "./attempt";
import { extractionFindings } from "./extract";

function schemaIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    pointer: `/content/${issue.path.join("/")}`,
  }));
}

function sameValue(a: string | null, b: string | null) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A PDF whose document (extracted, or parsed from the XML it embeds) is a document an XML
 * file of the same import already produced is the same message in another representation:
 * it is not published again. When their totals differ, the published document says so.
 */
async function sameAsParsedXml(
  context: ResultContext,
  documentType: AnyDocumentType,
  document: unknown,
): Promise<boolean> {
  const number = documentType.extractDocumentNumber(document);
  const sender = documentType.extractCounterparties(document).senderName;
  const results = await getImportResults(context.importRow.id);
  for (const other of results) {
    const structured = (other.checkpoints as Checkpoints).structured;
    if (other.id === context.result.id || structured?.method !== "parsed" || structured.type !== documentType.key) {
      continue;
    }
    if (
      !sameValue(number, documentType.extractDocumentNumber(structured.document)) ||
      !sameValue(sender, documentType.extractCounterparties(structured.document).senderName)
    ) {
      continue;
    }
    const totals = (value: unknown) => JSON.stringify((value as { totals?: unknown })?.totals ?? null);
    if (other.documentId && totals(document) !== totals(structured.document)) {
      await addDocumentFindings(other.documentId, [
        {
          code: "conflicting_representation",
          severity: "warning",
          scope: "business",
          message: `The PDF ${context.primaryFile.filename} of the same import shows other totals for this document.`,
          pointer: "/content/totals",
        },
      ]);
    }
    return true;
  }
  return false;
}

const IGNORED_REPRESENTATION = "Another representation of a document published from XML";

/**
 * An extracted document that can be published: parsed, with the values its type
 * corrected, what still does not add up, and the values that are wrong in another way.
 */
type Accepted = { document: unknown; corrections: Finding[]; discrepancies: Discrepancy[]; issues: Issue[] };

/** How many problems the model could still correct in an accepted document. */
function problemCount(verdict: Accepted) {
  return verdict.discrepancies.length + verdict.issues.length;
}

type Verdict = Accepted | { ignored: string } | { failure: Failure; repairHints: string[] | null };

/**
 * What an extracted document is worth: it must parse with the type's schema and show
 * the minimum evidence, or it cannot be published. `repairHints` tell the model what to
 * correct; a document without enough evidence is not repaired, because the model must
 * not invent values. A document whose values contradict each other can be published,
 * but it is first sent back to the model with its discrepancies.
 */
async function verify(context: ResultContext, documentType: AnyDocumentType, candidate: unknown): Promise<Verdict> {
  const parsed = documentType.documentSchema.safeParse(normalizeExtraction(documentType, candidate));
  if (!parsed.success) {
    return {
      failure: {
        ...failure("extraction_invalid", "The extracted content does not match the document type."),
        issues: schemaIssues(parsed.error),
      },
      repairHints: parsed.error.issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`),
    };
  }
  const missing = minimumEvidenceIssues(documentType, parsed.data);
  if (missing.length > 0) {
    return {
      failure: { ...failure("insufficient_evidence", "The document does not show enough to identify it."), issues: missing },
      repairHints: null,
    };
  }
  if (await sameAsParsedXml(context, documentType, parsed.data)) {
    return { ignored: IGNORED_REPRESENTATION };
  }
  const { document, findings: corrections } = reconcileExtraction(documentType, parsed.data);
  return {
    document,
    corrections,
    discrepancies: discrepancies(documentType, document),
    issues: extractionIssues(documentType, document, context.checkpoints.text?.text),
  };
}

function isAccepted(verdict: Verdict): verdict is Accepted {
  return "document" in verdict;
}

/** What the model must correct in its output, or null when there is nothing it can correct. */
function repairHintsOf(verdict: Verdict): string[] | null {
  if ("failure" in verdict) {
    return verdict.repairHints;
  }
  if (isAccepted(verdict) && problemCount(verdict) > 0) {
    return [...verdict.discrepancies.map(repairHint), ...verdict.issues.map(repairHint)];
  }
  return null;
}

/**
 * Verify the extracted document. While the model can correct it, ask it to, at most
 * `MAX_REPAIR_CALLS` times: each call gets the latest output and its problems. Of the
 * outputs that can be published, the one with the fewest problems is kept, the
 * latest of them on a tie: a repair can make a document worse.
 */
async function verifyExtraction(
  context: ResultContext,
  documentType: AnyDocumentType,
): Promise<{ verdict: Verdict; findings: Finding[] }> {
  const extracted = context.checkpoints.extract!;
  let document = extracted.document;
  let findings = extracted.findings;
  let verdict = await verify(context, documentType, document);
  let best = isAccepted(verdict) ? { verdict, findings } : null;
  for (let call = 0; call < MAX_REPAIR_CALLS; call++) {
    const repairHints = repairHintsOf(verdict);
    if (!repairHints) {
      break;
    }
    const model = getIntakeLanguageModel();
    if (!model) {
      throw new Error("No extraction model is configured");
    }
    const pdf = await context.readFile(context.primaryFile.id);
    const repair = { previous: document, issues: repairHints };
    const { output } = await withAttempt(context, "check", () =>
      extractWithModel({ model, pdf, documentType, company: context.company, repair }),
    );
    await context.progress();
    document = output.document;
    findings = extractionFindings(output.findings);
    verdict = await verify(context, documentType, document);
    if (isAccepted(verdict) && (!best || problemCount(verdict) <= problemCount(best.verdict as Accepted))) {
      best = { verdict, findings };
    }
  }
  if ("ignored" in verdict || !best) {
    return { verdict, findings };
  }
  return best;
}

async function check(context: ResultContext): Promise<StageOutcome> {
  const structured = context.checkpoints.structured;
  const parsed = structured?.method === "parsed" ? structured : null;
  const documentType = getDocumentType(parsed ? parsed.type : context.checkpoints.classify!.type)!;

  if (parsed) {
    // A hybrid PDF can repeat an XML file of the same import that its text did not prove it shows.
    if (parsed.xmlFileId !== context.primaryFile.id && (await sameAsParsedXml(context, documentType, parsed.document))) {
      return { ignored: IGNORED_REPRESENTATION };
    }
    // Received XML is recorded like a document received over Peppol: the publish stage
    // validates it and records the result, also when it is invalid.
    return {
      checkpoint: {
        document: parsed.document,
        findings: checkFindings(documentType, parsed.document, context.company),
      },
    };
  }

  const { verdict, findings } = await verifyExtraction(context, documentType);
  if ("ignored" in verdict) {
    return verdict;
  }
  if ("failure" in verdict) {
    return { failure: verdict.failure };
  }
  return {
    checkpoint: {
      document: verdict.document,
      findings: [
        ...findings,
        ...verdict.corrections,
        ...verdict.issues.map(issueFinding),
        ...ambiguousDateFindings(verdict.document, context.checkpoints.text?.text, findings),
        ...checkFindings(documentType, verdict.document, context.company),
      ],
    },
  };
}

/**
 * Check the document before publication: schema, minimum evidence and the type's
 * consistency check. An extracted document is not validated against the rules of a
 * format: it was never a message in a format, and a model that is asked to satisfy
 * such rules invents the values they require.
 */
export const checkStage: Stage = { name: "check", run: check };
