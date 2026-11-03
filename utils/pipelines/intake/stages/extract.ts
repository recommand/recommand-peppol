import type { Finding } from "@peppol/types/intake";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { extractWithModel, getIntakeLanguageModel } from "../models/claude";
import type { ExtractionOutput } from "../schemas";
import { failure, type Stage } from "../types";
import { withAttempt } from "./attempt";

/** A pointer into the document. A model can start it with the `document` property of its output. */
function documentPointer(pointer: string) {
  const absolute = pointer.startsWith("/") ? pointer : `/${pointer}`;
  return absolute === "/document" || absolute.startsWith("/document/") ? absolute.slice("/document".length) : absolute;
}

/** The model's findings as document findings, which point into the document's content. */
export function extractionFindings(findings: ExtractionOutput["findings"]): Finding[] {
  return (findings ?? []).map((finding) => ({
    code: finding.code,
    severity: "warning",
    scope: "extraction",
    message: finding.message,
    pointer: `/content${documentPointer(finding.pointer)}`,
  }));
}

/** Extract the content of the detected type from the PDF, with the type's schema as structured output. */
export const extractStage: Stage = {
  name: "extract",
  applies: (context) => context.checkpoints.structured?.method === null,
  async run(context) {
    const documentType = getDocumentType(context.checkpoints.classify!.type)!;
    const model = getIntakeLanguageModel();
    if (!model) {
      throw new Error("No extraction model is configured");
    }
    const pdf = await context.readFile(context.primaryFile.id);
    const { output, model: modelId } = await withAttempt(context, "extract", () =>
      extractWithModel({ model, pdf, documentType, company: context.company }),
    );
    if (output.multipleDocuments) {
      return {
        failure: failure(
          "multiple_messages_detected",
          "The PDF contains more than one document. Upload each document as a separate file.",
        ),
      };
    }
    return { checkpoint: { document: output.document, findings: extractionFindings(output.findings), model: modelId } };
  },
};
