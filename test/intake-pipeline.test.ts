import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ImportFile } from "@peppol/data/imports/files";
import type { Import } from "@peppol/data/imports/imports";
import type { ImportResult } from "@peppol/data/imports/results";
import {
  buildPdf,
  fakeDecisionModel,
  fakeLanguageModel,
  forbiddenDecisionModel,
  forbiddenLanguageModel,
  invoiceViewText,
  RECEIVING_COMPANY,
  SAMPLE_TYPES,
  sampleDocument,
  UNKNOWN_XML,
} from "./intake/fixtures";

// The stages of document intake against fakes: no database, no storage and no model
// calls. The database tests cover how the worker runs them.

mock.module("@recommand/db", () => ({ db: {} }));

const otherResults: ImportResult[] = [];
const addedFindings: unknown[] = [];
mock.module("@peppol/data/imports/results", () => ({
  getImportResults: async () => otherResults,
  addDocumentFindings: async (documentId: string, findings: unknown[]) => addedFindings.push({ documentId, findings }),
}));
// The answers of the validation service, in order; valid when none is left. A module
// mock stays for the whole test run, so other test files get the real client.
const validationAnswers: unknown[] = [];
const validatedXml: string[] = [];
let stubValidation = false;
const realValidation = { ...(await import("@peppol/data/validation/client")) };
mock.module("@peppol/data/validation/client", () => ({
  ...realValidation,
  validateXmlDocument: async (xml: string, options?: Parameters<typeof realValidation.validateXmlDocument>[1]) => {
    if (!stubValidation) {
      return realValidation.validateXmlDocument(xml, options);
    }
    validatedXml.push(xml);
    return validationAnswers.shift() ?? { result: "valid", errors: [] };
  },
}));
const derivedFiles: ImportFile[] = [];
const realFiles = await import("@peppol/data/imports/files");
mock.module("@peppol/data/imports/files", () => ({
  ...realFiles,
  findDerivedFile: async () => null,
  uploadImportFile: async (input: Record<string, unknown>) => ({ ...input, id: `file_derived_${derivedFiles.length}`, s3Key: "memory", sha256: "x", size: 1 }),
  insertImportFile: async (file: ImportFile) => {
    const row = { ...file, createdAt: new Date() };
    derivedFiles.push(row);
    return row;
  },
}));

const { setIntakeDecisionModelFactory } = await import("@peppol/utils/pipelines/intake/models/jev");
const { setIntakeLanguageModelFactory } = await import("@peppol/utils/pipelines/intake/models/claude");
const { structuredStage } = await import("@peppol/utils/pipelines/intake/stages/structured");
const { textStage } = await import("@peppol/utils/pipelines/intake/stages/text");
const { PermanentStageError, withAttempt } = await import("@peppol/utils/pipelines/intake/stages/attempt");
const { MAX_FILE_SIZE, MAX_PDF_PAGES } = await import("@peppol/utils/pipelines/intake/config");
const { APICallError } = await import("ai");
const { classifyPdf, decideClassification, classifyStage } = await import("@peppol/utils/pipelines/intake/stages/classify");
const { extractStage } = await import("@peppol/utils/pipelines/intake/stages/extract");
const { checkStage } = await import("@peppol/utils/pipelines/intake/stages/check");
const { extractionSchema } = await import("@peppol/utils/pipelines/intake/schemas");
const { isSameMessage } = await import("@peppol/utils/pipelines/intake/pairing");
const { detectFileKind, xmlFormat } = await import("@peppol/utils/pipelines/intake/file-kind");
const { countPdfPages, readPdfEmbeddedFiles, readPdfText, PdfUnreadableError } = await import("@peppol/utils/pipelines/intake/pdf");
const { aiIntakeTypes } = await import("@peppol/utils/pipelines/intake/document-types");
const { parseIncomingXml, IncomingXmlDecodeError } = await import("@peppol/utils/pipelines/receiving/parse");
const { getDocumentFormat } = await import("@peppol/utils/type-repository/document-formats");
type ResultContext = import("@peppol/utils/pipelines/intake/types").ResultContext;
type Checkpoints = import("@peppol/utils/pipelines/intake/types").Checkpoints;

function file(id: string, mediaType: string, filename = id): ImportFile {
  return {
    id,
    teamId: "team_1",
    companyId: "cmp_1",
    importId: "imp_1",
    filename,
    mediaType,
    format: null,
    size: 1,
    sha256: id,
    s3Key: id,
    provenance: { kind: "source" },
    createdAt: new Date(),
  };
}

/** A result of one file, with its bytes in memory. */
function context(options: {
  bytes: Buffer | string;
  mediaType: "application/pdf" | "application/xml";
  checkpoints?: Checkpoints;
  importRow?: Partial<Import>;
}): ResultContext & { attempts: unknown[] } {
  const primary = file("file_1", options.mediaType, options.mediaType === "application/pdf" ? "invoice.pdf" : "invoice.xml");
  const attempts: unknown[] = [];
  const bytes = Buffer.from(options.bytes);
  const files = new Map([[primary.id, primary]]);
  const result = {
    id: "res_1",
    importId: "imp_1",
    position: 0,
    sequence: null,
    locations: [{ fileId: primary.id, role: "primary" as const, range: null }],
    status: "pending" as const,
    checkpoints: {},
    documentId: null,
    error: null,
    publishedAt: null,
    createdAt: new Date(),
  };
  return {
    importRow: {
      id: "imp_1",
      teamId: "team_1",
      companyId: "cmp_1",
      channel: "api",
      expectedType: null,
      acceptedTypes: null,
      source: { channel: "api", requestId: "req_1" },
      ...options.importRow,
    } as Import,
    company: RECEIVING_COMPANY,
    result,
    checkpoints: options.checkpoints ?? {},
    files,
    primaryFile: primary,
    readFile: async () => bytes,
    addLocation: (location) => result.locations.push(location as never),
    addFile: (added) => files.set(added.id, added),
    recordAttempt: async (attempt) => {
      attempts.push(attempt);
    },
    attempts,
  };
}

const invoice = sampleDocument("invoice");
const textPdf = buildPdf({ pages: [invoiceViewText(invoice.document, invoice.number)] });
const scannedPdf = buildPdf({ pages: [""] });

beforeEach(() => {
  setIntakeDecisionModelFactory(() => forbiddenDecisionModel);
  setIntakeLanguageModelFactory(() => forbiddenLanguageModel());
  otherResults.length = 0;
  addedFindings.length = 0;
  derivedFiles.length = 0;
  validationAnswers.length = 0;
  validatedXml.length = 0;
  stubValidation = true;
});

afterAll(() => {
  stubValidation = false;
});

describe("files", () => {
  it("tells a PDF and well-formed XML from their content", () => {
    expect(detectFileKind(textPdf)).toBe("pdf");
    expect(detectFileKind(Buffer.from(invoice.xml))).toBe("xml");
    expect(detectFileKind(Buffer.from(`﻿${invoice.xml}`))).toBe("xml");
    expect(detectFileKind(Buffer.from("<Invoice><unclosed></Invoice>"))).toBeNull();
    expect(detectFileKind(Buffer.from("hello"))).toBeNull();
  });

  it("names the syntax of an XML document by its root namespace", () => {
    expect(xmlFormat(invoice.xml)).toBe("ubl");
    expect(xmlFormat(sampleDocument("invoice", "cii-d22b-en16931").xml)).toBe("cii");
    expect(xmlFormat(UNKNOWN_XML)).toBe("xml");
  });

  it("reads the text layer, the pages and the embedded files of a PDF", async () => {
    const pdf = buildPdf({ pages: ["first page", "second page"], attachments: [{ name: "factur-x.xml", content: "<a/>" }] });
    expect(await countPdfPages(pdf)).toBe(2);
    expect((await readPdfText(pdf)).text).toContain("second page");
    expect((await readPdfText(scannedPdf)).text).toBe("");
    const embedded = await readPdfEmbeddedFiles(pdf);
    expect(embedded.map((entry) => [entry.filename, entry.content.toString()])).toEqual([["factur-x.xml", "<a/>"]]);
    expect(readPdfText(Buffer.from("%PDF-1.7 damaged"))).rejects.toBeInstanceOf(PdfUnreadableError);
  });
});

describe("parseIncomingXml", () => {
  it("parses XML with its format and type", () => {
    const format = getDocumentFormat("peppol-ubl-bis3-invoice")!;
    const parsed = parseIncomingXml(format, invoice.xml, format.supportedProcessIds[0]);
    expect(parsed.documentType.key).toBe("invoice");
  });

  it("throws with the recognised type when the document does not decode", () => {
    const format = getDocumentFormat("peppol-ubl-bis3-invoice")!;
    const broken = invoice.xml.replace(/<cbc:IssueDate>[^<]*<\/cbc:IssueDate>/, "<cbc:IssueDate>not a date</cbc:IssueDate>").replace(/<cac:InvoiceLine>[\s\S]*<\/cac:InvoiceLine>/, "");
    try {
      parseIncomingXml(format, broken, format.supportedProcessIds[0]);
      throw new Error("expected a decode error");
    } catch (error) {
      expect(error).toBeInstanceOf(IncomingXmlDecodeError);
      expect((error as InstanceType<typeof IncomingXmlDecodeError>).documentType.key).toBe("invoice");
    }
  });
});

describe("structured stage", () => {
  it("parses an XML file with its format, without a model", async () => {
    const outcome = await structuredStage.run(context({ bytes: invoice.xml, mediaType: "application/xml" }));
    expect(outcome).toMatchObject({ checkpoint: { method: "parsed", formatKey: "peppol-ubl-bis3-invoice", type: "invoice", xmlFileId: "file_1" } });
  });

  it("parses CII as well as UBL", async () => {
    const cii = sampleDocument("invoice", "cii-d22b-en16931");
    const outcome = await structuredStage.run(context({ bytes: cii.xml, mediaType: "application/xml" }));
    expect(outcome).toMatchObject({ checkpoint: { method: "parsed", type: "invoice" } });
  });

  it("fails XML that no format recognises, without falling back to AI", async () => {
    const outcome = await structuredStage.run(context({ bytes: UNKNOWN_XML, mediaType: "application/xml" }));
    expect(outcome).toMatchObject({ failure: { code: "unsupported_format" } });
  });

  it("fails XML that is not well-formed as unreadable", async () => {
    const outcome = await structuredStage.run(context({ bytes: "<Invoice><a></Invoice>", mediaType: "application/xml" }));
    expect(outcome).toMatchObject({ failure: { code: "file_unreadable" } });
  });

  it("fails XML of another type than the expected one", async () => {
    const creditNote = sampleDocument("creditNote");
    const outcome = await structuredStage.run(
      context({ bytes: creditNote.xml, mediaType: "application/xml", importRow: { expectedType: "invoice" } }),
    );
    expect(outcome).toMatchObject({ failure: { code: "type_mismatch", context: { detectedType: "creditNote" } } });
  });

  it("fails a type the receiving address does not accept", async () => {
    const outcome = await structuredStage.run(
      context({ bytes: invoice.xml, mediaType: "application/xml", importRow: { acceptedTypes: ["creditNote"] } }),
    );
    expect(outcome).toMatchObject({ failure: { code: "unsupported_document_type" } });
  });

  it("parses the XML embedded in a hybrid PDF and keeps it as a derived file", async () => {
    const cii = sampleDocument("invoice", "cii-d22b-en16931");
    const hybrid = buildPdf({ pages: ["Invoice"], attachments: [{ name: "factur-x.xml", content: cii.xml }] });
    const run = context({ bytes: hybrid, mediaType: "application/pdf" });
    const outcome = await structuredStage.run(run);
    expect(outcome).toMatchObject({ checkpoint: { method: "parsed", type: "invoice", xmlFileId: "file_derived_0" } });
    expect(derivedFiles[0].provenance).toEqual({ kind: "derived", operation: "unwrap", inputs: [{ fileId: "file_1", range: null }] });
    expect(run.result.locations).toEqual([
      { fileId: "file_1", role: "primary", range: null },
      { fileId: "file_derived_0", role: "supporting", range: null },
    ]);
  });

  it("sends a PDF without XML to the AI stages", async () => {
    expect(await structuredStage.run(context({ bytes: textPdf, mediaType: "application/pdf" }))).toEqual({ checkpoint: { method: null } });
  });

  it("fails a PDF that cannot be opened", async () => {
    const outcome = await structuredStage.run(context({ bytes: "%PDF-1.7 broken", mediaType: "application/pdf" }));
    expect(outcome).toMatchObject({ failure: { code: "file_unreadable" } });
  });
});

describe("text stage", () => {
  it("reads the text layer without a model call, and an empty one for a scanned PDF", async () => {
    const run = context({ bytes: scannedPdf, mediaType: "application/pdf", checkpoints: { structured: { method: null } } });
    expect(textStage.applies!(run)).toBe(true);
    const outcome = (await textStage.run(run)) as { checkpoint: { text: string; pageCount: number } };
    expect(outcome.checkpoint.text).toBe("");
    expect(outcome.checkpoint.pageCount).toBe(1);
  });

  it("fails a PDF over the page limit before any model call", async () => {
    const long = buildPdf({ pages: Array.from({ length: MAX_PDF_PAGES + 1 }, (_, page) => `Page ${page + 1}`) });
    const run = context({ bytes: long, mediaType: "application/pdf", checkpoints: { structured: { method: null } } });
    expect(await textStage.run(run)).toMatchObject({
      failure: { code: "page_limit_exceeded", context: { pageCount: MAX_PDF_PAGES + 1, maxPages: MAX_PDF_PAGES } },
    });
  });

  it("fails a PDF over the size limit without reading it", async () => {
    const run = context({ bytes: textPdf, mediaType: "application/pdf", checkpoints: { structured: { method: null } } });
    run.primaryFile.size = MAX_FILE_SIZE + 1;
    run.readFile = async () => {
      throw new Error("The file must not be read");
    };
    expect(await textStage.run(run)).toMatchObject({ failure: { code: "file_too_large", context: { maxSize: MAX_FILE_SIZE } } });
  });

  it("does not apply to a parsed result", () => {
    const run = context({ bytes: invoice.xml, mediaType: "application/xml", checkpoints: { structured: { method: "parsed" } as never } });
    expect(textStage.applies!(run)).toBe(false);
    expect(classifyStage.applies!(run)).toBe(false);
    expect(extractStage.applies!(run)).toBe(false);
  });
});

describe("classification", () => {
  const invoiceAnswer = () => ({ invoice: 0.9, creditNote: 0.05, none: 0.05 });

  it("gives Jev the text layer, not the PDF", async () => {
    const fake = fakeDecisionModel(invoiceAnswer);
    setIntakeDecisionModelFactory(() => fake.model);
    const result = await classifyPdf({ pdf: textPdf, text: "INVOICE 1", filename: "a.pdf", subject: "Invoice" });
    expect(result.probabilities.invoice).toBe(0.9);
    expect(fake.calls[0].state).toEqual([{ type: "json", value: { filename: "a.pdf", subject: "Invoice", text: "INVOICE 1" } }]);
    expect(fake.calls[0].options.map((option) => option.id)).toEqual([...aiIntakeTypes().map((type) => type.key), "other", "none"]);
  });

  it("classifies a scanned PDF with the extraction model", async () => {
    const model = fakeLanguageModel({ result: "Credit Note" });
    setIntakeLanguageModelFactory(() => model);
    const result = await classifyPdf({ pdf: scannedPdf, text: "", filename: "scan.pdf", subject: null });
    expect(result.probabilities).toEqual({ creditNote: 1 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("is uncertain when the extraction model cannot tell the type of a scanned PDF", async () => {
    setIntakeLanguageModelFactory(() => fakeLanguageModel({ result: "Unclear" }));
    const result = await classifyPdf({ pdf: scannedPdf, text: "", filename: "scan.pdf", subject: null });
    expect(decideClassification(result, { expectedType: null, acceptedTypes: null })).toMatchObject({
      failure: { code: "classification_uncertain" },
    });
  });

  const decide = (probabilities: Record<string, number>, expectedType: string | null = null, acceptedTypes: string[] | null = null) =>
    decideClassification({ probabilities, model: "m" }, { expectedType, acceptedTypes });

  it("turns the probabilities into a type or a failure", () => {
    expect(decide({ invoice: 0.8, none: 0.2 })).toMatchObject({ type: { type: "invoice", probability: 0.8 } });
    expect(decide({ none: 0.9 })).toEqual({ ignored: "Not a business document" });
    expect(decide({ other: 0.7 })).toMatchObject({ failure: { code: "unsupported_document_type" } });
    expect(decide({ invoice: 0.4, creditNote: 0.35 })).toMatchObject({ failure: { code: "classification_uncertain" } });
    expect(decide({ invoice: 0.9 }, null, ["creditNote"])).toMatchObject({ failure: { code: "unsupported_document_type" } });
  });

  it("holds an expected type as a constraint", () => {
    expect(decide({ creditNote: 0.9 }, "invoice")).toMatchObject({ failure: { code: "type_mismatch", context: { detectedType: "creditNote" } } });
    expect(decide({ none: 0.9 }, "invoice")).toMatchObject({ failure: { code: "type_mismatch", context: { detectedType: null } } });
    expect(decide({ invoice: 0.3, creditNote: 0.3 }, "invoice")).toMatchObject({ type: { type: "invoice" } });
  });

  it("records the model call as an attempt", async () => {
    setIntakeDecisionModelFactory(() => fakeDecisionModel(invoiceAnswer).model);
    const run = context({ bytes: textPdf, mediaType: "application/pdf", checkpoints: { structured: { method: null }, text: { text: "x", pageCount: 1, textHash: "h" } } });
    expect(await classifyStage.run(run)).toMatchObject({ checkpoint: { type: "invoice" } });
    expect(run.attempts).toEqual([expect.objectContaining({ stage: "classify", model: "fake-decision-model", inputTokens: 100 })]);
  });
});

describe("model call errors", () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: `HTTP ${statusCode}`, url: "https://gateway.example", requestBodyValues: {}, statusCode });
  const run = () => context({ bytes: textPdf, mediaType: "application/pdf" });

  it("fails the result at once when the model service refuses the request", async () => {
    for (const statusCode of [400, 413, 415, 422]) {
      const attempt = run();
      const call = withAttempt(attempt, "extract", async () => {
        throw apiError(statusCode);
      });
      await expect(call).rejects.toBeInstanceOf(PermanentStageError);
      await expect(call).rejects.toMatchObject({ failure: { code: "input_rejected", context: { stage: "extract", statusCode } } });
      expect(attempt.attempts).toEqual([expect.objectContaining({ stage: "extract", model: null, error: `HTTP ${statusCode}` })]);
    }
  });

  it("leaves service, rate limit and account errors to the retry schedule", async () => {
    for (const error of [apiError(429), apiError(503), apiError(401), apiError(404), new Error("fetch failed")]) {
      const call = withAttempt(run(), "classify", async () => {
        throw error;
      });
      await expect(call).rejects.toBe(error);
    }
  });
});

describe("pairing", () => {
  const xml = { documentType: invoice.documentType, document: invoice.document };

  it("pairs a PDF whose text shows the number, date, payable amount and seller VAT number", () => {
    expect(isSameMessage(xml, { sha256: "other", text: invoiceViewText(invoice.document, invoice.number) })).toBe(true);
  });

  it("pairs a PDF that prints the issue date with the name of the month", () => {
    const [year, month, day] = String(invoice.document.issueDate).split("-");
    const numeric = `Date: ${day}/${month}/${year}`;
    const view = invoiceViewText(invoice.document, invoice.number);
    const english = new Date(`${invoice.document.issueDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const german = new Date(`${invoice.document.issueDate}T00:00:00Z`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    expect(isSameMessage(xml, { sha256: "other", text: view.replace(numeric, `Date: ${english}`) })).toBe(true);
    expect(isSameMessage(xml, { sha256: "other", text: view.replace(numeric, `Datum: ${german}`) })).toBe(true);
    expect(isSameMessage(xml, { sha256: "other", text: view.replace(numeric, `Date: 31 ${english.split(" ")[1]} 1999`) })).toBe(false);
  });

  it("does not pair on the document number alone", () => {
    expect(isSameMessage(xml, { sha256: "other", text: `Invoice ${invoice.number}` })).toBe(false);
  });

  it("does not pair a scanned PDF, which has no text to prove it", () => {
    expect(isSameMessage(xml, { sha256: "other", text: "" })).toBe(false);
  });

  it("pairs a PDF whose bytes the XML embeds", () => {
    const pdf = Buffer.from("%PDF-1.7 view");
    const embedding = {
      ...xml,
      document: { ...invoice.document, attachments: [{ mimeCode: "application/pdf", embeddedDocument: pdf.toString("base64") }] },
    };
    expect(isSameMessage(embedding, { sha256: realFiles.sha256Hex(pdf), text: "" })).toBe(true);
  });
});

describe("extraction schema", () => {
  it("wraps the document schema of every AI intake type, without the fields a model must not fill", () => {
    for (const documentType of aiIntakeTypes()) {
      const schema = extractionSchema(documentType) as { properties: Record<string, any>; required: string[] };
      expect(schema.required).toEqual(["document", "findings", "multipleDocuments"]);
      expect(schema.properties.document.properties).toBeDefined();
      expect(schema.properties.document.properties.attachments).toBeUndefined();
      expect(JSON.stringify(schema)).not.toContain('"examples"');
    }
  });
});

/** Run extract and check for a classified PDF, with the given model outputs. */
async function extractAndCheck(type: string, outputs: unknown[], importRow: Partial<Import> = {}) {
  const model = fakeLanguageModel(...outputs);
  setIntakeLanguageModelFactory(() => model);
  const run = context({
    bytes: textPdf,
    mediaType: "application/pdf",
    importRow,
    checkpoints: {
      structured: { method: null },
      text: { text: "", pageCount: 1, textHash: "h" },
      classify: { type, probability: 0.9, probabilities: {}, model: "m" },
    },
  });
  const extracted = await extractStage.run(run);
  if (!("checkpoint" in extracted)) {
    return { outcome: extracted, model, run };
  }
  run.checkpoints.extract = extracted.checkpoint as never;
  return { outcome: await checkStage.run(run), model, run };
}

describe("extract and check", () => {
  it.each(SAMPLE_TYPES)("runs the generic stages for %s", async (type) => {
    const sample = sampleDocument(type);
    const { outcome, model } = await extractAndCheck(type, [{ document: sample.document, findings: [], multipleDocuments: false }]);
    expect(outcome).toMatchObject({ checkpoint: { document: expect.any(Object) } });
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(JSON.stringify(call.prompt)).toContain("application/pdf");
    expect(call.responseFormat).toMatchObject({ type: "json" });
  });

  it("keeps the model's findings, pointing into the document content", async () => {
    const { outcome } = await extractAndCheck("invoice", [
      {
        document: invoice.document,
        findings: [{ pointer: "/invoiceNumber", code: "uncertain_value", message: "Hard to read." }],
        multipleDocuments: false,
      },
    ]);
    expect((outcome as { checkpoint: { findings: unknown[] } }).checkpoint.findings).toContainEqual({
      code: "uncertain_value",
      severity: "warning",
      scope: "extraction",
      message: "Hard to read.",
      pointer: "/content/invoiceNumber",
    });
  });

  it("fails a PDF with more than one document", async () => {
    const { outcome } = await extractAndCheck("invoice", [{ document: invoice.document, findings: [], multipleDocuments: true }]);
    expect(outcome).toMatchObject({ failure: { code: "multiple_messages_detected" } });
  });

  it("repairs an output that does not parse once", async () => {
    const { outcome, model } = await extractAndCheck("invoice", [
      { document: { ...invoice.document, lines: [] }, findings: [], multipleDocuments: false },
      { document: invoice.document, findings: [], multipleDocuments: false },
    ]);
    expect(outcome).toMatchObject({ checkpoint: { document: expect.any(Object) } });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("has these problems");
  });

  it("fails an output that still does not parse after the repair", async () => {
    const invalid = { document: { ...invoice.document, lines: [] }, findings: [], multipleDocuments: false };
    const { outcome } = await extractAndCheck("invoice", [invalid, invalid]);
    expect(outcome).toMatchObject({ failure: { code: "extraction_invalid", issues: [expect.objectContaining({ pointer: "/content/lines" })] } });
  });

  const invalidAnswer = {
    result: "invalid",
    errors: [
      { ruleCode: "BR-CO-15", errorMessage: "Invoice total amount with VAT is wrong.", errorLevel: "ERROR", fieldName: "/Invoice/LegalMonetaryTotal" },
      { ruleCode: "PEPPOL-R001", errorMessage: "A warning only.", errorLevel: "WARNING", fieldName: null },
    ],
  };

  it("validates the encoded document and keeps the validation for publication", async () => {
    const { outcome } = await extractAndCheck("invoice", [{ document: invoice.document, findings: [], multipleDocuments: false }]);
    expect(validatedXml).toHaveLength(1);
    expect(validatedXml[0]).toContain("<Invoice");
    expect(outcome).toMatchObject({ checkpoint: { validation: { result: "valid" } } });
  });

  it("repairs a document that does not pass validation once", async () => {
    validationAnswers.push(invalidAnswer);
    const output = { document: invoice.document, findings: [], multipleDocuments: false };
    const { outcome, model } = await extractAndCheck("invoice", [output, output]);
    expect(outcome).toMatchObject({ checkpoint: { validation: { result: "valid" } } });
    expect(model.doGenerateCalls).toHaveLength(2);
    const repairPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(repairPrompt).toContain("BR-CO-15: Invoice total amount with VAT is wrong. (at /Invoice/LegalMonetaryTotal)");
    expect(repairPrompt).not.toContain("A warning only.");
  });

  it("fails a document that still does not pass validation after the repair", async () => {
    validationAnswers.push(invalidAnswer, invalidAnswer);
    const output = { document: invoice.document, findings: [], multipleDocuments: false };
    const { outcome, model } = await extractAndCheck("invoice", [output, output]);
    expect(outcome).toEqual({
      failure: expect.objectContaining({
        code: "extraction_invalid",
        message: "The extracted document does not pass validation.",
        issues: [{ code: "BR-CO-15", message: "Invoice total amount with VAT is wrong." }],
      }),
    });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("lets a document through when the validation service fails, like a received document", async () => {
    validationAnswers.push({ result: "error", errors: [] });
    const { outcome, model } = await extractAndCheck("invoice", [{ document: invoice.document, findings: [], multipleDocuments: false }]);
    expect(outcome).toMatchObject({ checkpoint: { validation: { result: "error" } } });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("fails a document without the minimum evidence", async () => {
    const { totals: _totals, ...withoutTotals } = invoice.document;
    const { outcome } = await extractAndCheck("invoice", [{ document: withoutTotals, findings: [], multipleDocuments: false }]);
    expect(outcome).toMatchObject({ failure: { code: "insufficient_evidence", issues: [{ code: "missing_payable_amount" }] } });
  });

  it("reports totals that do not add up and a receiver that is not the company", async () => {
    const document = {
      ...invoice.document,
      buyer: { ...invoice.document.buyer, name: "Somebody Else" },
      totals: { ...invoice.document.totals, taxInclusiveAmount: "999.99" },
    };
    const { outcome } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    const codes = (outcome as { checkpoint: { findings: { code: string }[] } }).checkpoint.findings.map((finding) => finding.code);
    expect(codes).toContain("receiver_mismatch");
    expect(codes).toContain("inconsistent_totals");
  });

  it("ignores a PDF that repeats a document published from the XML of the same import", async () => {
    otherResults.push({
      id: "res_xml",
      documentId: "doc_xml",
      checkpoints: { structured: { method: "parsed", type: "invoice", document: invoice.document } },
    } as never);
    const document = { ...invoice.document, totals: { ...invoice.document.totals, payableAmount: "1.00" } };
    const { outcome } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    expect(outcome).toEqual({ ignored: "Another representation of a document published from XML" });
    expect(addedFindings).toEqual([
      { documentId: "doc_xml", findings: [expect.objectContaining({ code: "conflicting_representation" })] },
    ]);
  });
});
