import { findDerivedFile, insertImportFile, sha256Hex, uploadImportFile } from "@peppol/data/imports/files";
import { IncomingXmlDecodeError, parseIncomingXml } from "@peppol/utils/pipelines/receiving/parse";
import { detectDocumentFormat, resolveFormatProcessId } from "@peppol/utils/type-repository/document-formats";
import { typeConstraintFailure } from "../document-types";
import { detectFileKind, MEDIA_TYPES, xmlFormat, xmlText } from "../file-kind";
import { PdfUnreadableError, readPdfEmbeddedFiles } from "../pdf";
import { failure, type ResultContext, type Stage, type StageOutcome } from "../types";

/**
 * Parse XML with the registered formats. A file has no envelope, so it is decoded
 * under the format's first process and given the process its content selects.
 * Invalid structured content fails: it never falls back to AI.
 */
export function parseXmlResult(context: ResultContext, xml: string, xmlFileId: string): StageOutcome {
  const format = detectDocumentFormat(xml);
  if (!format) {
    return { failure: failure("unsupported_format", "No supported format recognises this XML document.") };
  }
  let parsed: ReturnType<typeof parseIncomingXml>;
  try {
    parsed = parseIncomingXml(format, xml, format.supportedProcessIds[0]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      failure: failure("unsupported_format", `The ${format.translatableTitle} document could not be read: ${detail}`, {
        format: format.key,
        ...(error instanceof IncomingXmlDecodeError ? { detectedType: error.documentType.key } : {}),
      }),
    };
  }
  const type = parsed.documentType.key;
  const constraint = typeConstraintFailure(context.importRow, type);
  if (constraint) {
    return { failure: constraint };
  }
  return {
    checkpoint: {
      method: "parsed",
      formatKey: format.key,
      type,
      processId: resolveFormatProcessId(format, parsed.parsedDocument),
      document: parsed.parsedDocument,
      xmlFileId,
    },
  };
}

/** The first embedded file that is XML in a format we recognise. */
export function findStructuredXml<T extends { content: Buffer }>(embedded: T[]): T | undefined {
  return embedded.find((file) => detectFileKind(file.content) === "xml" && detectDocumentFormat(xmlText(file.content)));
}

/** Keep the XML embedded in a PDF as a file of its own, derived from the PDF. */
async function storeEmbeddedXml(context: ResultContext, filename: string, bytes: Buffer) {
  const existing = await findDerivedFile(context.importRow.id, sha256Hex(bytes));
  if (existing) {
    return existing;
  }
  const xml = xmlText(bytes);
  return await insertImportFile(
    await uploadImportFile({
      teamId: context.importRow.teamId,
      companyId: context.importRow.companyId,
      importId: context.importRow.id,
      filename,
      mediaType: MEDIA_TYPES.xml,
      format: xmlFormat(xml),
      bytes,
      provenance: {
        kind: "derived",
        operation: "unwrap",
        inputs: [{ fileId: context.primaryFile.id, range: null }],
      },
    }),
  );
}

/**
 * Get the structured content of a result: the XML file itself, or the XML a hybrid PDF
 * (Factur-X, ZUGFeRD) embeds. A PDF without recognised XML continues to the AI stages.
 */
export const structuredStage: Stage = {
  name: "structured",
  async run(context) {
    const bytes = await context.readFile(context.primaryFile.id);
    if (context.primaryFile.mediaType === MEDIA_TYPES.xml) {
      if (detectFileKind(bytes) !== "xml") {
        return { failure: failure("file_unreadable", "The XML file is not well-formed.") };
      }
      return parseXmlResult(context, xmlText(bytes), context.primaryFile.id);
    }

    let embedded: Awaited<ReturnType<typeof readPdfEmbeddedFiles>>;
    try {
      embedded = await readPdfEmbeddedFiles(bytes);
    } catch (error) {
      if (error instanceof PdfUnreadableError) {
        return { failure: failure("file_unreadable", "The PDF file cannot be read. It may be damaged or encrypted.") };
      }
      throw error;
    }
    const structured = findStructuredXml(embedded);
    if (!structured) {
      return { checkpoint: { method: null } };
    }
    const file = await storeEmbeddedXml(context, structured.filename, structured.content);
    context.addFile(file);
    context.addLocation({ fileId: file.id, role: "supporting", range: null });
    return parseXmlResult(context, xmlText(structured.content), file.id);
  },
};
