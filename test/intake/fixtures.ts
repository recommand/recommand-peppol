import { MockLanguageModelV4 } from "ai/test";
import type { Company } from "@peppol/data/companies";
import type { DecisionModel, DecisionRequest } from "@peppol/utils/pipelines/intake/models/jev";
import {
  getDocumentFormat,
  getDocumentFormatsByDocumentTypeKey,
  resolveFormatProcessId,
} from "@peppol/utils/type-repository/document-formats";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import {
  creditNoteDocument,
  invoiceDocument,
  selfBillingCreditNoteDocument,
  selfBillingInvoiceDocument,
} from "../e2e/documents";

// Fixtures for document intake: PDFs built in memory, documents of every type that AI
// intake supports, and fake models that record their calls. No test calls a real model.

/**
 * A minimal PDF: one page per entry of `pages`, each line of a page as text, and
 * optional embedded files, like the XML of a Factur-X invoice. A page with an empty
 * string has no text layer, as a scanned page has none.
 */
export function buildPdf(options: { pages: string[]; attachments?: { name: string; content: string }[] }): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentIds = options.pages.map((text) => {
    const lines = text
      .split("\n")
      .filter(Boolean)
      .map((line, index) => `BT /F1 11 Tf 50 ${750 - index * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    return add(`<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`);
  });
  const pagesId = objects.length + options.pages.length + 1;
  const pageIds = contentIds.map((contentId) =>
    add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`),
  );
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  let names = "";
  if (options.attachments?.length) {
    const specs = options.attachments.map((attachment) => {
      const fileId = add(
        `<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${Buffer.byteLength(attachment.content)} >>\nstream\n${attachment.content}\nendstream`,
      );
      return { name: attachment.name, id: add(`<< /Type /Filespec /F (${attachment.name}) /UF (${attachment.name}) /EF << /F ${fileId} 0 R >> >>`) };
    });
    names = ` /Names << /EmbeddedFiles << /Names [${specs.map((spec) => `(${spec.name}) ${spec.id} 0 R`).join(" ")}] >> >>`;
  }
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R${names} >>`);
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** The company that receives the documents: the buyer of the sample documents. */
export const RECEIVING_COMPANY = {
  name: "Recommand E2E Buyer",
  vatNumber: "BE0598726857",
  country: "BE",
  address: "Teststraat 2",
  city: "Antwerp",
  postalCode: "2000",
  enterpriseNumber: null,
  enterpriseNumberScheme: null,
  email: null,
  phone: null,
} as unknown as Company;

const SEND_DOCUMENTS = {
  invoice: invoiceDocument,
  creditNote: creditNoteDocument,
  selfBillingInvoice: selfBillingInvoiceDocument,
  selfBillingCreditNote: selfBillingCreditNoteDocument,
} as const;

export type SampleType = keyof typeof SEND_DOCUMENTS;
export const SAMPLE_TYPES = Object.keys(SEND_DOCUMENTS) as SampleType[];

/**
 * A document of a type, as its preferred UBL format writes it, and as that XML reads
 * back: with the totals the XML states, as a model would copy them from a PDF.
 */
export function sampleDocument(type: SampleType, formatKey?: string) {
  const documentType = getDocumentType(type)!;
  const canonical = documentType.documentSchema.parse(
    documentType.preprocessFromSendAPI({ documentType: type, document: SEND_DOCUMENTS[type]() } as never, {
      company: RECEIVING_COMPANY,
    }),
  );
  const format = formatKey ? getDocumentFormat(formatKey)! : getDocumentFormatsByDocumentTypeKey(type)[0];
  const processId = resolveFormatProcessId(format, canonical);
  const xml = format.encode(canonical, processId, {
    senderAddress: "0208:1234567894",
    recipientAddress: "0208:0598726857",
    isDocumentValidationEnforced: false,
  });
  const document = documentType.documentSchema.parse(format.decode(xml, processId)) as Record<string, any>;
  return { xml, document, documentType, number: documentType.extractDocumentNumber(document)! };
}

/** The text a PDF view of a sample invoice shows: number, date, total and seller VAT number. */
export function invoiceViewText(document: Record<string, any>, number: string) {
  const [year, month, day] = String(document.issueDate).split("-");
  return [
    `INVOICE ${number}`,
    `Date: ${day}/${month}/${year}`,
    `${document.seller.name}`,
    `VAT ${document.seller.vatNumber}`,
    `Total to pay: EUR ${document.totals.payableAmount ?? document.totals.taxInclusiveAmount}`,
  ].join("\n");
}

export const UNKNOWN_XML = `<?xml version="1.0" encoding="UTF-8"?><Catalogue xmlns="urn:example:catalogue"><Item>1</Item></Catalogue>`;

/** A decision model that answers from a function and records every request. */
export function fakeDecisionModel(answer: (request: DecisionRequest) => Record<string, number>) {
  const calls: DecisionRequest[] = [];
  const model: DecisionModel = {
    id: "fake-decision-model",
    decide: async (request) => {
      calls.push(request);
      return { probabilities: answer(request), usage: { inputTokens: 100, outputTokens: 1 } };
    },
  };
  return { model, calls };
}

/** A decision model that fails the test when it is called. */
export const forbiddenDecisionModel: DecisionModel = {
  id: "forbidden",
  decide: async () => {
    throw new Error("The decision model must not be called");
  },
};

/** A language model that returns the given outputs as JSON text, in order, and records each call. */
export function fakeLanguageModel(...outputs: unknown[]) {
  const results = outputs.map((output) => ({
    content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 200, text: 200, reasoning: 0 },
    },
    warnings: [],
  }));
  return new MockLanguageModelV4({ modelId: "fake-language-model", doGenerate: results as never });
}

/** A language model that fails the test when it is called. */
export function forbiddenLanguageModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("The language model must not be called");
    },
  });
}
