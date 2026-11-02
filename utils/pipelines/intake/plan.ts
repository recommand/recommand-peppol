import { getImportFiles, readImportFile, type ImportFile } from "@peppol/data/imports/files";
import type { Import } from "@peppol/data/imports/imports";
import { savePlannedResults } from "@peppol/data/imports/results";
import type { Failure, SourceLocation } from "@peppol/types/intake";
import { parseIncomingXml } from "@peppol/utils/pipelines/receiving/parse";
import { detectDocumentFormat } from "@peppol/utils/type-repository/document-formats";
import { detectFileKind, MEDIA_TYPES, xmlText } from "./file-kind";
import { isSameMessage, type PairingXml } from "./pairing";
import { PdfUnreadableError, readPdfTextAndEmbeddedFiles } from "./pdf";
import { findStructuredXml } from "./stages/structured";
import { failure } from "./types";

type Candidate = {
  file: ImportFile;
  readable: boolean;
  /** A PDF that embeds XML in a recognised format (Factur-X, ZUGFeRD). */
  hybrid?: boolean;
  /** The parsed XML of an XML file or of a hybrid PDF, for the pairing proof. */
  xml?: PairingXml;
  /** The text layer of a PDF, for the pairing proof. */
  text?: string;
};

function pairingXml(xml: string): PairingXml | undefined {
  const format = detectDocumentFormat(xml);
  try {
    const parsed = format ? parseIncomingXml(format, xml, format.supportedProcessIds[0]) : null;
    return parsed ? { documentType: parsed.documentType, document: parsed.parsedDocument } : undefined;
  } catch {
    return undefined;
  }
}

async function inspect(file: ImportFile): Promise<Candidate> {
  const bytes = await readImportFile(file);
  if (file.mediaType === MEDIA_TYPES.xml) {
    if (detectFileKind(bytes) !== "xml") {
      return { file, readable: false };
    }
    return { file, readable: true, xml: pairingXml(xmlText(bytes)) };
  }
  try {
    const { text, embeddedFiles } = await readPdfTextAndEmbeddedFiles(bytes);
    const structured = findStructuredXml(embeddedFiles);
    return { file, readable: true, text, hybrid: !!structured, xml: structured && pairingXml(xmlText(structured.content)) };
  } catch (error) {
    if (error instanceof PdfUnreadableError) {
      return { file, readable: false };
    }
    throw error;
  }
}

const location = (file: ImportFile, role: SourceLocation["role"]): SourceLocation => ({ fileId: file.id, role, range: null });

/**
 * The import-level step: turn the received files into results. A file with the same
 * bytes as an earlier file is a supporting location of that file's result. Each other
 * PDF or XML file is a result, except a PDF that is proven to show the same message as
 * a parsed XML file or hybrid PDF: that PDF becomes a supporting location of their
 * result. Results come in this order: XML files, hybrid PDFs, other PDFs. Thus a PDF
 * that repeats a structured document is checked against it. Returns the whole-input
 * failure when no file can be read, and `ignored` when there is nothing to process.
 */
export async function planImport(importRow: Import): Promise<"planned" | "ignored" | Failure> {
  const files = (await getImportFiles(importRow.id)).filter(
    (file) =>
      file.provenance.kind === "source" &&
      (file.mediaType === MEDIA_TYPES.pdf || file.mediaType === MEDIA_TYPES.xml),
  );
  if (files.length === 0) {
    await savePlannedResults(importRow.id, []);
    return "ignored";
  }
  const firstByHash = new Map<string, ImportFile>();
  const copies = new Map<string, ImportFile[]>();
  for (const file of files) {
    const first = firstByHash.get(file.sha256);
    if (first) {
      copies.set(first.id, [...(copies.get(first.id) ?? []), file]);
    } else {
      firstByHash.set(file.sha256, file);
    }
  }
  const candidates = await Promise.all([...firstByHash.values()].map(inspect));
  if (!candidates.some((candidate) => candidate.readable)) {
    return failure("input_unreadable", "None of the files can be read. They may be damaged or encrypted.");
  }

  const pdfFiles = candidates.filter((candidate) => candidate.file.mediaType === MEDIA_TYPES.pdf);
  const ordered = [
    ...candidates.filter((candidate) => candidate.file.mediaType === MEDIA_TYPES.xml),
    ...pdfFiles.filter((candidate) => candidate.hybrid),
    ...pdfFiles.filter((candidate) => !candidate.hybrid),
  ];
  const withCopies = (file: ImportFile, role: SourceLocation["role"]) => [
    location(file, role),
    ...(copies.get(file.id) ?? []).map((copy) => location(copy, "supporting")),
  ];
  const taken = new Set<string>();
  const planned: { locations: SourceLocation[] }[] = [];
  for (const candidate of ordered) {
    if (taken.has(candidate.file.id)) {
      continue;
    }
    taken.add(candidate.file.id);
    const xml = candidate.xml;
    const supporting = xml
      ? pdfFiles.filter(
          (pdf) =>
            pdf.readable &&
            !taken.has(pdf.file.id) &&
            isSameMessage(xml, { sha256: pdf.file.sha256, text: pdf.text ?? "" }),
        )
      : [];
    for (const pdf of supporting) {
      taken.add(pdf.file.id);
    }
    planned.push({
      locations: [
        ...withCopies(candidate.file, "primary"),
        ...supporting.flatMap((pdf) => withCopies(pdf.file, "supporting")),
      ],
    });
  }
  await savePlannedResults(importRow.id, planned);
  return "planned";
}
