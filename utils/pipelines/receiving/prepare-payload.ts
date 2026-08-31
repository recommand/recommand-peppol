import { UserFacingError } from "@directory/utils/util";
import {
  detectDocumentFormat,
  getDocumentFormatByDocTypeId,
} from "@peppol/utils/type-repository/document-formats";
import type {
  PreparedIncomingPayload,
  IncomingDocumentInput,
} from "./types";

export async function prepareIncomingPayload(
  input: IncomingDocumentInput,
): Promise<PreparedIncomingPayload> {
  const format = getDocumentFormatByDocTypeId(input.docTypeId);
  const mimeType = input.contentType?.toLowerCase().split(";")[0].trim();

  if (format?.container) {
    if (mimeType !== format.container.contentType) {
      throw new UserFacingError(
        `${format.translatableTitle} documents must be received as ${format.container.contentType}.`,
      );
    }

    const content = Buffer.from(await new Response(input.body).arrayBuffer());
    return {
      format,
      xmlDocument: await format.container.unwrap(content),
      originalPayload: {
        content,
        containerFormat: format.container.containerFormat,
      },
    };
  }

  if (mimeType && mimeType !== "application/xml") {
    throw new UserFacingError(
      "Binary payloads are only supported for document types with a registered container.",
    );
  }

  const xmlDocument = await new Response(input.body).text();
  return {
    format: format ?? detectDocumentFormat(xmlDocument),
    xmlDocument,
    originalPayload: null,
  };
}
