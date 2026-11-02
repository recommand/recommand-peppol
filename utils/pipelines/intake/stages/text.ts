import { sha256Hex } from "@peppol/data/imports/files";
import { MAX_FILE_SIZE, MAX_PDF_PAGES } from "../config";
import { PdfUnreadableError, readPdfText } from "../pdf";
import { failure, type Stage } from "../types";

// Enough text for every check that reads it; a very long PDF is cut, not refused.
const MAX_STORED_TEXT = 200_000;

/**
 * Read the text layer of a PDF without a model. A scanned PDF has none, which is not an
 * error. A PDF over the limits of the models fails here, before any model call: the API
 * refuses such a file at upload, but an email attachment is only checked here.
 */
export const textStage: Stage = {
  name: "text",
  applies: (context) => context.checkpoints.structured?.method === null,
  async run(context) {
    if (context.primaryFile.size > MAX_FILE_SIZE) {
      return {
        failure: failure("file_too_large", `The PDF file is larger than ${MAX_FILE_SIZE / 1024 / 1024} MB.`, {
          size: context.primaryFile.size,
          maxSize: MAX_FILE_SIZE,
        }),
      };
    }
    try {
      const { text, pageCount } = await readPdfText(await context.readFile(context.primaryFile.id));
      if (pageCount > MAX_PDF_PAGES) {
        return {
          failure: failure("page_limit_exceeded", `The PDF has ${pageCount} pages; at most ${MAX_PDF_PAGES} are supported.`, {
            pageCount,
            maxPages: MAX_PDF_PAGES,
          }),
        };
      }
      return { checkpoint: { text: text.slice(0, MAX_STORED_TEXT), pageCount, textHash: sha256Hex(text) } };
    } catch (error) {
      if (error instanceof PdfUnreadableError) {
        return { failure: failure("file_unreadable", "The PDF file cannot be read. It may be damaged or encrypted.") };
      }
      throw error;
    }
  },
};
