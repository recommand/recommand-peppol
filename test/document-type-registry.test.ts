import { describe, expect, it } from "bun:test";
import { fallbackT } from "@core/lib/translations";
import { supportedDocumentTypes } from "../db/schema";
import {
  getDocumentTypeLabel,
  getDocumentTypeTitle,
} from "../lib/client/document-type-labels";
import { getDocumentFilename } from "../utils/document-filename";
import { documentTypes, getDocumentType } from "../utils/type-repository/document-types";
import {
  BILLING_DOCUMENT_TYPE_KEYS,
  REPORTING_DOCUMENT_TYPE_KEYS,
  STORED_DOCUMENT_TYPE_KEYS,
  TRANSACTION_MESSAGING_DOCUMENT_TYPE_KEYS,
} from "../utils/type-repository/document-types/keys";

/**
 * Adding a document type used to mean editing the same list in five places and
 * the same label in four. These tests fail if any of them grows a second copy.
 */
describe("document type registry", () => {
  it("registers exactly the document types the stored enum knows", () => {
    expect(
      documentTypes.map((documentType) => documentType.key as string),
    ).toEqual([
      ...BILLING_DOCUMENT_TYPE_KEYS,
      ...TRANSACTION_MESSAGING_DOCUMENT_TYPE_KEYS,
      ...REPORTING_DOCUMENT_TYPE_KEYS,
    ] as string[]);

    // `unknown` is the only stored type without a registry entry: it is what a
    // document that could not be parsed is filed as.
    expect([...STORED_DOCUMENT_TYPE_KEYS] as string[]).toEqual([
      ...documentTypes.map((documentType) => documentType.key as string),
      "unknown",
    ]);
  });

  it("declares the database enum from that same list", () => {
    // Drizzle builds the Postgres enum from these options, so a value appearing
    // here that the list does not have would need a migration nobody wrote.
    expect(supportedDocumentTypes.options as string[]).toEqual([
      ...STORED_DOCUMENT_TYPE_KEYS,
    ] as string[]);
  });

  it("names every document type once, in the label module", () => {
    for (const key of STORED_DOCUMENT_TYPE_KEYS) {
      const title = getDocumentTypeTitle(key);
      expect(title, key).toBeTruthy();
      expect(title, key).not.toBe(key);
      expect(getDocumentTypeLabel(fallbackT, key), key).toBe(title);
    }

    // The registry does not repeat the names; it reads them from there.
    for (const documentType of documentTypes) {
      expect(documentType.translatableTitle, documentType.key).toBe(
        getDocumentTypeTitle(documentType.key),
      );
    }
  });

  it("falls back to the raw value for a type it does not know", () => {
    expect(getDocumentTypeLabel(fallbackT, "somethingElse")).toBe(
      "somethingElse",
    );
  });

  it("asks the document type for a filename and a document number", () => {
    // Naming a document used to sniff the parsed payload's shape, which mistook
    // a report for the invoice it reports on.
    const report = {
      reference: "REPORT-1",
      type: "payment" as const,
      invoiceNumber: "INV-1",
    };

    expect(getDocumentFilename("frenchB2BiPaymentReport", report as never)).toBe(
      "french-cross-border-payment-report-REPORT-1",
    );
    expect(
      getDocumentType("frenchB2BiPaymentReport")?.extractDocumentNumber(report),
    ).toBe("REPORT-1");

    const invoice = { invoiceNumber: "INV-1" };
    expect(getDocumentFilename("invoice", invoice as never)).toBe("invoice-INV-1");
    expect(getDocumentFilename("selfBillingInvoice", invoice as never)).toBe(
      "self-billing-invoice-INV-1",
    );
    expect(getDocumentType("invoice")?.extractDocumentNumber(invoice)).toBe(
      "INV-1",
    );
  });

  it("names no filename for a type it does not know", () => {
    expect(getDocumentFilename("unknown", { invoiceNumber: "INV-1" } as never)).toBe(
      "document",
    );
    expect(getDocumentType("unknown")).toBeUndefined();
  });

  it("resolves every stored type through the registry except unknown", () => {
    for (const key of STORED_DOCUMENT_TYPE_KEYS) {
      const documentType = getDocumentType(key);
      if (key === "unknown") {
        expect(documentType).toBeUndefined();
        continue;
      }
      expect(documentType?.key as string, key).toBe(key as string);
    }
  });
});
