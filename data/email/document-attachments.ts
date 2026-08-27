import type { Attachment } from "postmark";

export function extractDocumentAttachments(
  parsedDocument: unknown,
): Attachment[] {
  if (
    !parsedDocument ||
    typeof parsedDocument !== "object" ||
    !("attachments" in parsedDocument) ||
    !Array.isArray(parsedDocument.attachments)
  ) {
    return [];
  }

  return parsedDocument.attachments.flatMap((attachment) =>
    attachment?.embeddedDocument
      ? [{
          Content: attachment.embeddedDocument,
          ContentID: null,
          ContentType: attachment.mimeCode,
          Name: attachment.filename,
        }]
      : [],
  );
}
