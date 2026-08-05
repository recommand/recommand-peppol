import type { Attachment } from "@peppol/utils/parsing/invoice/schemas";

/**
 * Put a generated attachment on a document, replacing whatever already sits under its
 * name. `generateAndAttachPdf` matches the generated filename against both `filename`
 * and `id` — the two hold the same string for a generated PDF — so regenerating one
 * never leaves the previous copy behind.
 */
export function withGeneratedAttachment(
  attachments: Attachment[] | null | undefined,
  attachment: Attachment
): Attachment[] {
  const existing = Array.isArray(attachments) ? attachments : [];
  return [
    ...existing.filter(
      (candidate) =>
        candidate.filename !== attachment.filename &&
        candidate.id !== attachment.filename
    ),
    attachment,
  ];
}
