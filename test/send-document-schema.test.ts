import { describe, expect, it } from "bun:test";
import {
  DocumentType,
  documentTypeSchema,
  sendDocumentSchema,
} from "../utils/parsing/send-document";
import { getDocumentType } from "../utils/type-repository/document-types";

describe("send document schema", () => {
  it("pairs every document type with its own registry entry", () => {
    // The registry types `key` as the union of all keys, so TypeScript cannot
    // catch a variant wired up to the wrong entry. This can.
    for (const option of sendDocumentSchema.options) {
      const documentType = option.shape.documentType.value;
      if (documentType === DocumentType.XML) continue;

      const entry = getDocumentType(documentType);
      expect(entry?.key).toBe(documentType);
      expect(option.shape.document as unknown).toBe(
        entry!.sendSchema as unknown,
      );
    }
  });

  it("accepts every document type the enum lists", () => {
    expect(sendDocumentSchema.options.map((o) => o.shape.documentType.value))
      .toEqual([...documentTypeSchema.options]);
  });

  it("reports problems for the selected document type only", () => {
    const result = sendDocumentSchema.safeParse({
      recipient: "0208:1012081766",
      documentType: DocumentType.INVOICE,
      document: { invoiceNumber: "INV-1" },
    });

    expect(result.success).toBe(false);
    const paths = result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("document.buyer");
    expect(paths.every((path) => path.startsWith("document."))).toBe(true);
  });

  it("rejects an unknown document type on the discriminator", () => {
    const result = sendDocumentSchema.safeParse({
      recipient: "0208:1012081766",
      documentType: "notADocumentType",
      document: {},
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe("invalid_union_discriminator");
    expect(issue?.path).toEqual(["documentType"]);
  });
});
