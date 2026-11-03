import { addDocumentFindings, getImportResults } from "@peppol/data/imports/results";
import { validateXmlDocument } from "@peppol/data/validation/client";
import type { Failure, Finding, Issue } from "@peppol/types/intake";
import type { ValidationResponse } from "@peppol/types/validation";
import { getValidationProfile } from "@peppol/utils/type-repository/document-formats";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import type { z } from "zod";
import { checkFindings, minimumEvidenceIssues, normalizeExtraction } from "../checks";
import { encodeResult } from "../encode";
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

type Verdict =
  | { document: unknown; validation: ValidationResponse }
  | { ignored: string }
  | { failure: Failure; repairHints: string[] | null };

/**
 * What an extracted document is worth: it must parse with the type's schema, show the
 * minimum evidence and pass validation once encoded. `repairHints` tell the model what to
 * correct; a document without enough evidence is not repaired, because the model must not
 * invent values. Like a received document, a document that could not be validated
 * because the validation service failed goes through.
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
  const document = parsed.data;
  const missing = minimumEvidenceIssues(documentType, document);
  if (missing.length > 0) {
    return {
      failure: { ...failure("insufficient_evidence", "The document does not show enough to identify it."), issues: missing },
      repairHints: null,
    };
  }
  if (await sameAsParsedXml(context, documentType, document)) {
    return { ignored: IGNORED_REPRESENTATION };
  }

  const encoded = await encodeResult(context, documentType, document);
  if ("error" in encoded) {
    return {
      failure: failure("extraction_invalid", `The extracted content could not be written as a document: ${encoded.error}`),
      repairHints: [encoded.error],
    };
  }
  const validation = await validateXmlDocument(encoded.xml, { profile: getValidationProfile(encoded.docTypeId) });
  if (validation.result !== "invalid") {
    return { document, validation };
  }
  const errors = validation.errors.filter((error) => !/^warn/i.test(error.errorLevel));
  return {
    failure: {
      ...failure("extraction_invalid", "The extracted document does not pass validation."),
      issues: errors.map((error) => ({ code: error.ruleCode || "validation_error", message: error.errorMessage })),
    },
    repairHints: errors.map(
      (error) =>
        `${error.ruleCode ? `${error.ruleCode}: ` : ""}${error.errorMessage}${error.fieldName ? ` (at ${error.fieldName})` : ""}`,
    ),
  };
}

/**
 * Verify the extracted document. While the model can correct it, ask it to, at most
 * `MAX_REPAIR_CALLS` times: each call gets the latest output and its problems.
 */
async function verifyExtraction(
  context: ResultContext,
  documentType: AnyDocumentType,
): Promise<{ verdict: Verdict; findings: Finding[] }> {
  const extracted = context.checkpoints.extract!;
  let document = extracted.document;
  let findings = extracted.findings;
  let verdict = await verify(context, documentType, document);
  for (let call = 0; call < MAX_REPAIR_CALLS; call++) {
    if (!("failure" in verdict) || !verdict.repairHints) {
      break;
    }
    const model = getIntakeLanguageModel();
    if (!model) {
      throw new Error("No extraction model is configured");
    }
    const pdf = await context.readFile(context.primaryFile.id);
    const repair = { previous: document, issues: verdict.repairHints };
    const { output } = await withAttempt(context, "check", () =>
      extractWithModel({ model, pdf, documentType, company: context.company, repair }),
    );
    await context.progress();
    document = output.document;
    findings = extractionFindings(output.findings);
    verdict = await verify(context, documentType, document);
  }
  return { verdict, findings };
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
      findings: [...findings, ...checkFindings(documentType, verdict.document, context.company)],
      validation: verdict.validation,
    },
  };
}

/**
 * Check the document before publication: schema, minimum evidence, the checks of its
 * class and, for an extracted document, validation.
 */
export const checkStage: Stage = { name: "check", run: check };
