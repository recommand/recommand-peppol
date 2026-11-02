import { extractText, getDocumentProxy } from "unpdf";

/** A PDF that cannot be opened: damaged, encrypted, or not a PDF at all. */
export class PdfUnreadableError extends Error {
  constructor(cause: unknown) {
    super(`The PDF cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PdfUnreadableError";
  }
}

/** Free what pdf.js keeps for an open document, where the build offers it. */
async function release(document: unknown) {
  await (document as { cleanup?: () => Promise<void> }).cleanup?.();
}

// pdf.js takes over the buffer it is given, so every call gets its own copy.
async function open(bytes: Uint8Array) {
  try {
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    throw new PdfUnreadableError(error);
  }
}

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const document = await open(bytes);
  try {
    return document.numPages;
  } finally {
    await release(document);
  }
}

type PdfDocument = Awaited<ReturnType<typeof open>>;
type EmbeddedFile = { filename: string; content: Buffer };

/** Open a PDF, read it, and free it again. Any error while reading makes the PDF unreadable. */
async function readPdf<T>(bytes: Uint8Array, read: (document: PdfDocument) => Promise<T>): Promise<T> {
  const document = await open(bytes);
  try {
    return await read(document);
  } catch (error) {
    throw error instanceof PdfUnreadableError ? error : new PdfUnreadableError(error);
  } finally {
    await release(document);
  }
}

async function textOf(document: PdfDocument) {
  const { text, totalPages } = await extractText(document, { mergePages: true });
  return { text: text.trim(), pageCount: totalPages };
}

async function embeddedFilesOf(document: PdfDocument): Promise<EmbeddedFile[]> {
  const attachments = (await document.getAttachments()) as
    | Map<string, { filename: string }>
    | Record<string, { filename: string }>
    | null;
  const entries = attachments instanceof Map ? [...attachments] : Object.entries(attachments ?? {});
  const files: EmbeddedFile[] = [];
  for (const [id, attachment] of entries) {
    const content = await (
      document as unknown as { getAttachmentContent(id: string): Promise<Uint8Array | null> }
    ).getAttachmentContent(id);
    if (content) {
      files.push({ filename: attachment.filename, content: Buffer.from(content) });
    }
  }
  return files;
}

/** The text layer of a PDF, empty for a scanned PDF, and its number of pages. */
export function readPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  return readPdf(bytes, textOf);
}

/** The files embedded in a PDF, such as the XML of a Factur-X or ZUGFeRD invoice. */
export function readPdfEmbeddedFiles(bytes: Uint8Array): Promise<EmbeddedFile[]> {
  return readPdf(bytes, embeddedFilesOf);
}

/** The text layer and the embedded files of a PDF, read from one open document. */
export function readPdfTextAndEmbeddedFiles(
  bytes: Uint8Array,
): Promise<{ text: string; embeddedFiles: EmbeddedFile[] }> {
  return readPdf(bytes, async (document) => ({
    text: (await textOf(document)).text,
    embeddedFiles: await embeddedFilesOf(document),
  }));
}
