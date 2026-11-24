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
  OPERATIONAL_SAMPLE_TYPES,
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
// What `runResult` saved and published, and an error the next checkpoint save throws.
const savedCheckpoints: Record<string, unknown>[] = [];
const publishedFailures: unknown[] = [];
let saveError: unknown = null;
mock.module("@peppol/data/imports/results", () => ({
  getImportResults: async () => otherResults,
  addDocumentFindings: async (documentId: string, findings: unknown[]) => addedFindings.push({ documentId, findings }),
  saveResultCheckpoints: async (_resultId: string, checkpoints: Record<string, unknown>) => {
    if (saveError) throw saveError;
    savedCheckpoints.push(structuredClone(checkpoints));
  },
  publishFailedResult: async (_importId: string, _resultId: string, error: unknown) => publishedFailures.push(error),
  ignoreResult: async () => {},
  recordAttempt: async () => {},
  publishDocumentResult: async () => {},
}));
// The answers of the validation service, in order; valid when none is left. A module
// mock stays for the whole test run, so other test files get the real client. Intake
// validates received XML only, so the stub also shows that it validates nothing else.
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

const { decisionModelOver, setIntakeDecisionModelFactory } = await import("@peppol/utils/pipelines/intake/models/jev");
const { setIntakeLanguageModelFactory } = await import("@peppol/utils/pipelines/intake/models/claude");
const { structuredStage } = await import("@peppol/utils/pipelines/intake/stages/structured");
const { textStage } = await import("@peppol/utils/pipelines/intake/stages/text");
const { PermanentStageError, withAttempt } = await import("@peppol/utils/pipelines/intake/stages/attempt");
const { MAX_FILE_SIZE, MAX_PDF_PAGES } = await import("@peppol/utils/pipelines/intake/config");
const { MAX_REPAIR_CALLS } = await import("@peppol/utils/pipelines/intake/models/config");
const { APICallError } = await import("ai");
const { classifyPdf, decideClassification, classifyStage } = await import("@peppol/utils/pipelines/intake/stages/classify");
const { extractStage } = await import("@peppol/utils/pipelines/intake/stages/extract");
const { checkStage } = await import("@peppol/utils/pipelines/intake/stages/check");
const { extractionSchema } = await import("@peppol/utils/pipelines/intake/schemas");
const { isSameMessage } = await import("@peppol/utils/pipelines/intake/pairing");
const { detectFileKind, xmlFormat } = await import("@peppol/utils/pipelines/intake/file-kind");
const { countPdfPages, readPdfEmbeddedFiles, readPdfText, PdfUnreadableError } = await import("@peppol/utils/pipelines/intake/pdf");
const { aiIntakeTypes } = await import("@peppol/utils/pipelines/intake/document-types");
const { runResult } = await import("@peppol/utils/pipelines/intake");
const { storable, storableText } = await import("@peppol/utils/storable");
const { isDataException } = await import("@peppol/utils/db-errors");
const { parseIncomingXml, IncomingXmlDecodeError } = await import("@peppol/utils/pipelines/receiving/parse");
const { getDocumentFormat, getDocumentFormatsByDocumentTypeKey, resolveFormatProcessId } = await import(
  "@peppol/utils/type-repository/document-formats"
);
const { getDocumentType } = await import("@peppol/utils/type-repository/document-types");
const { resultEnvelope } = await import("@peppol/utils/pipelines/intake/envelope");
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
}): ResultContext & { attempts: unknown[]; progressCalls: number } {
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
  const run: ResultContext & { attempts: unknown[]; progressCalls: number } = {
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
    progress: async () => {
      run.progressCalls++;
    },
    attempts,
    progressCalls: 0,
  };
  return run;
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

  // Some PDFs draw a dash with a glyph whose text is NUL, which PostgreSQL cannot store.
  it("replaces the control characters of a text layer, and keeps the words apart", async () => {
    const pdf = buildPdf({ pages: ["Invoice number INV\u00000042", "Period Mar 1\u0000Mar 31\u0007 EUR 20"] });
    const { text } = await readPdfText(pdf);
    expect(text).toContain("Invoice number INV\uFFFD0042");
    expect(text).toContain("Period Mar 1\uFFFDMar 31\uFFFD EUR 20");
  });
});

describe("storable text", () => {
  it("replaces what PostgreSQL or XML refuses, in every string of a value", () => {
    expect(storableText("a\u0000b\u001Fc\td\ne\rf")).toBe("a\uFFFDb\uFFFDc\td\ne\rf");
    expect(storableText("lone \uD800 surrogate, pair \uD83D\uDE00")).toBe("lone \uFFFD surrogate, pair \uD83D\uDE00");
    const date = new Date();
    expect(storable<unknown>({ "k\u0000": ["x\u0000", 1, null, { y: "\u0000" }], date })).toEqual({
      "k\uFFFD": ["x\uFFFD", 1, null, { y: "\uFFFD" }],
      date,
    });
  });

  it("recognises a data exception of PostgreSQL, also when Drizzle wrapped it", () => {
    const wrapped = Object.assign(new Error("Failed query: update ..."), { cause: Object.assign(new Error("unsupported Unicode escape sequence"), { code: "22P05" }) });
    expect(isDataException(wrapped)).toBe(true);
    expect(isDataException(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isDataException(new Error("socket hang up"))).toBe(false);
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

  it("stores and hashes the text with its control characters replaced", async () => {
    const pdf = buildPdf({ pages: ["Invoice number INV\u00000042"] });
    const run = context({ bytes: pdf, mediaType: "application/pdf", checkpoints: { structured: { method: null } } });
    const outcome = (await textStage.run(run)) as { checkpoint: { text: string; textHash: string } };
    expect(outcome.checkpoint.text).toBe("Invoice number INV\uFFFD0042");
    expect(outcome.checkpoint.textHash).toBe(realFiles.sha256Hex("Invoice number INV\uFFFD0042"));
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

  it("describes each type to the classifier, so that an order or a delivery note is not taken for an invoice", async () => {
    const fake = fakeDecisionModel(() => ({ despatchAdvice: 0.85, invoice: 0.1, none: 0.05 }));
    setIntakeDecisionModelFactory(() => fake.model);
    const result = await classifyPdf({ pdf: textPdf, text: "PAKBON DN-2026-118", filename: "pakbon.pdf", subject: null });
    const request = fake.calls[0];
    const descriptions = Object.fromEntries(request.options.map((option) => [option.id, option.description]));
    expect(descriptions.invoice).toContain("asks the buyer to pay");
    expect(descriptions.order).toContain("purchase order");
    expect(descriptions.despatchAdvice).toContain("delivery note");
    expect(descriptions.orderResponse).toBeUndefined();
    expect(request.instructions).toContain("A document that asks for payment is not the same as a document that orders or delivers goods");
    expect(request.instructions).not.toContain("such as an order, a delivery note");
    expect(decideClassification(result, { expectedType: null, acceptedTypes: null })).toMatchObject({
      type: { type: "despatchAdvice", probability: 0.85 },
    });
  });

  it("gives Jev the descriptions as the criteria of the options", async () => {
    const calls: { questions: Record<string, { criteria: Record<string, unknown> }> }[] = [];
    const jev = decisionModelOver(
      {
        specificationVersion: "v4",
        provider: "fake",
        modelId: "fake-jev",
        supportedQuestionTypes: ["choice"],
        doDecide: async (options: never) => {
          calls.push(options);
          return {
            answers: { answer: { type: "choice", choice: "Order", probabilities: { Order: 0.9, Invoice: 0.1 } } },
            warnings: [],
          };
        },
      } as never,
      "fake-jev",
    );
    const result = await jev.decide(
      {
        state: [{ type: "text", text: "PURCHASE ORDER" }],
        instructions: "Which document?",
        options: [
          { id: "order", label: "Order", description: "The buyer orders goods." },
          { id: "invoice", label: "Invoice" },
        ],
      },
      {},
    );
    expect(calls[0].questions.answer.criteria).toEqual({ Order: "The buyer orders goods.", Invoice: null });
    expect(result.probabilities).toEqual({ order: 0.9, invoice: 0.1 });
  });

  it("gives the extraction model the description of each option for a scanned PDF", async () => {
    const model = fakeLanguageModel({ result: "Order" });
    setIntakeLanguageModelFactory(() => model);
    const result = await classifyPdf({ pdf: scannedPdf, text: "", filename: "scan.pdf", subject: null });
    expect(result.probabilities).toEqual({ order: 1 });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("- Order: The buyer orders goods or services from the seller");
    expect(prompt).toContain("- Despatch Advice: The party that sends goods lists what it delivers");
  });

  it("decides on an order or a delivery note like on any other type", () => {
    expect(decide({ order: 0.8, invoice: 0.15 })).toMatchObject({ type: { type: "order", probability: 0.8 } });
    expect(decide({ despatchAdvice: 0.9 }, "invoice")).toMatchObject({
      failure: { code: "type_mismatch", context: { detectedType: "despatchAdvice", expectedType: "invoice" } },
    });
    expect(decide({ order: 0.9 }, null, ["invoice", "creditNote"])).toMatchObject({
      failure: { code: "unsupported_document_type", context: { detectedType: "order" } },
    });
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

describe("running a result", () => {
  const run = () => context({ bytes: textPdf, mediaType: "application/pdf", checkpoints: { structured: { method: null } } });
  beforeEach(() => {
    savedCheckpoints.length = 0;
    publishedFailures.length = 0;
    saveError = null;
  });

  it("makes what a stage returns storable before the next stage reads it or it is saved", async () => {
    const decision = fakeDecisionModel(() => ({ invoice: 0.95 }));
    setIntakeDecisionModelFactory(() => ({ ...decision.model, id: "decision\u0000model" }));
    setIntakeLanguageModelFactory(() => null);
    const result = run();
    await expect(runResult(result)).rejects.toThrow("No extraction model is configured");
    expect(result.checkpoints.classify).toMatchObject({ model: "decision\uFFFDmodel" });
    expect(savedCheckpoints.at(-1)!.classify).toMatchObject({ model: "decision\uFFFDmodel" });
  });

  it("fails the result at once when the database refuses a value, instead of retrying it", async () => {
    saveError = Object.assign(new Error("Failed query: update ..."), {
      cause: Object.assign(new Error("unsupported Unicode escape sequence"), { code: "22P05" }),
    });
    await runResult(run());
    expect(publishedFailures).toEqual([{ code: "input_rejected", message: expect.any(String), context: { stage: "text" } }]);
  });

  it("leaves any other database error to the retry schedule", async () => {
    saveError = new Error("Connection terminated unexpectedly");
    await expect(runResult(run())).rejects.toBe(saveError);
    expect(publishedFailures).toEqual([]);
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

  it("covers the invoice and credit note types, the order and the despatch advice, but not the order response", () => {
    const keys = aiIntakeTypes().map((type) => type.key);
    expect(keys).toEqual(expect.arrayContaining(["invoice", "creditNote", "order", "despatchAdvice"]));
    expect(keys).not.toContain("orderResponse");
    expect(Object.keys((extractionSchema(getDocumentType("despatchAdvice")!) as any).properties.document.properties)).not.toContain("totals");
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
    // The rules of the billing class come with the rules for every type.
    expect(JSON.stringify(call.prompt)).toContain("Use VAT category S only with a rate above 0.");
    expect(call.responseFormat).toMatchObject({ type: "json" });
  });

  it("keeps the model's findings, pointing into the document content", async () => {
    const { outcome } = await extractAndCheck("invoice", [
      {
        document: invoice.document,
        findings: [
          { pointer: "/invoiceNumber", code: "uncertain_value", message: "Hard to read." },
          { pointer: "/document/seller/name", code: "uncertain_value", message: "Small print." },
          { pointer: "document", code: "missing_value", message: "No page 2." },
        ],
        multipleDocuments: false,
      },
    ]);
    const findings = (outcome as { checkpoint: { findings: { pointer: string; [key: string]: unknown }[] } }).checkpoint.findings;
    expect(findings).toContainEqual({
      code: "uncertain_value",
      severity: "warning",
      scope: "extraction",
      message: "Hard to read.",
      pointer: "/content/invoiceNumber",
    });
    // A pointer that starts with the document property of the output points into the content.
    expect(findings.map((finding) => finding.pointer)).toEqual(
      expect.arrayContaining(["/content/seller/name", "/content"]),
    );
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

  it("fails an output that still does not parse after three repairs", async () => {
    const invalid = { document: { ...invoice.document, lines: [] }, findings: [], multipleDocuments: false };
    const { outcome, model, run } = await extractAndCheck("invoice", [invalid, invalid, invalid, invalid]);
    expect(outcome).toMatchObject({ failure: { code: "extraction_invalid", issues: [expect.objectContaining({ pointer: "/content/lines" })] } });
    expect(model.doGenerateCalls).toHaveLength(1 + MAX_REPAIR_CALLS);
    expect(run.progressCalls).toBe(MAX_REPAIR_CALLS);
  });

  it("reads a document that the model wrote as a JSON string", async () => {
    const finding = { pointer: "/invoiceNumber", code: "uncertain_value", message: "Hard to read." };
    const { outcome, model } = await extractAndCheck("invoice", [
      { document: JSON.stringify(invoice.document), findings: [], multipleDocuments: false },
    ]);
    expect(outcome).toMatchObject({ checkpoint: { document: { invoiceNumber: invoice.number } } });
    expect(model.doGenerateCalls).toHaveLength(1);

    // The rest of the output can follow the document in the same string.
    const { outcome: withRest, run } = await extractAndCheck("invoice", [
      {
        document: `${JSON.stringify(invoice.document)},"findings":[${JSON.stringify(finding)},{"pointer":1}]}`,
        findings: [],
        multipleDocuments: false,
      },
    ]);
    expect(run.checkpoints.extract).toMatchObject({ document: { invoiceNumber: invoice.number } });
    expect((withRest as { checkpoint: { findings: unknown[] } }).checkpoint.findings).toContainEqual(
      expect.objectContaining({ code: "uncertain_value", pointer: "/content/invoiceNumber" }),
    );
  });

  it("repairs an output without a document", async () => {
    const { outcome, model } = await extractAndCheck("invoice", [
      { findings: [], multipleDocuments: false },
      { document: invoice.document, findings: [], multipleDocuments: false },
    ]);
    expect(outcome).toMatchObject({ checkpoint: { document: expect.any(Object) } });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("has these problems");
  });

  it("repairs a string that is not a document", async () => {
    const { outcome, model } = await extractAndCheck("invoice", [
      { document: "not a document", findings: [], multipleDocuments: false },
      { document: invoice.document, findings: [], multipleDocuments: false },
    ]);
    expect(outcome).toMatchObject({ checkpoint: { document: expect.any(Object) } });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("writes one VAT breakdown per category and rate", async () => {
    const { lines, vat, totals } = invoice.document;
    const deposit = (netAmount: string) => ({
      ...lines[0],
      name: "Crate",
      netPriceAmount: netAmount.replace("-", ""),
      quantity: netAmount.startsWith("-") ? "-1" : "1",
      netAmount,
      vat: { category: "Z", percentage: "0" },
    });
    const document = {
      ...invoice.document,
      lines: [...lines, deposit("120.00"), deposit("-40.00")],
      vat: {
        ...vat,
        subtotals: [
          ...vat.subtotals,
          { category: "Z", percentage: "0", taxableAmount: "120.00", vatAmount: "0.00", exemptionReason: "Deposit" },
          { category: "Z", percentage: "0.00", taxableAmount: "-40.00", vatAmount: "0.00", exemptionReason: "Deposit returned" },
        ],
      },
      totals: {
        ...totals,
        linesAmount: totals.linesAmount && (Number(totals.linesAmount) + 80).toFixed(2),
        taxExclusiveAmount: (Number(totals.taxExclusiveAmount) + 80).toFixed(2),
        taxInclusiveAmount: (Number(totals.taxInclusiveAmount) + 80).toFixed(2),
        payableAmount: totals.payableAmount && (Number(totals.payableAmount) + 80).toFixed(2),
      },
    };
    const { outcome } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    const checked = (outcome as { checkpoint: { document: Record<string, any> } }).checkpoint.document;
    expect(checked.vat.subtotals).toHaveLength(vat.subtotals.length + 1);
    expect(checked.vat.subtotals.at(-1)).toMatchObject({
      category: "Z",
      taxableAmount: "80.00",
      vatAmount: "0.00",
      exemptionReason: "Deposit; Deposit returned",
    });
  });

  it("writes registration numbers and printed units in the form the formats require", async () => {
    const document = {
      ...invoice.document,
      seller: { ...invoice.document.seller, vatNumber: "BE 0403.201.185", enterpriseNumber: "0403.201.185" },
      lines: invoice.document.lines.map((line: Record<string, unknown>, index: number) => ({
        ...line,
        unitCode: ["kg", "PCE", "FF"][index % 3],
      })),
    };
    const { outcome } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    const checked = (outcome as { checkpoint: { document: Record<string, any> } }).checkpoint.document;
    expect(checked.seller).toMatchObject({ vatNumber: "BE0403201185", enterpriseNumber: "0403201185" });
    // FF is a valid code (hundred cubic metre), so it stays.
    expect(checked.lines.map((line: { unitCode: string }) => line.unitCode)).toEqual(
      document.lines.map((_: unknown, index: number) => ["KGM", "H87", "FF"][index % 3]),
    );
  });

  it("empties a placeholder that the model wrote for a value that is not printed", async () => {
    const document = { ...invoice.document, buyer: { ...invoice.document.buyer, street: "<UNKNOWN>", city: "N/A" } };
    const { outcome } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    const checked = (outcome as { checkpoint: { document: Record<string, any> } }).checkpoint.document;
    expect(checked.buyer).toMatchObject({ street: "", city: "" });
  });

  it("leaves out an optional object that states nothing, for every type, without a repair", async () => {
    const document = {
      ...invoice.document,
      billingPeriod: { startDate: null, endDate: "" },
      delivery: { date: null, location: { country: "" } },
      lines: invoice.document.lines.map((line: Record<string, unknown>) => ({ ...line, standardId: { scheme: "", identifier: "" } })),
    };
    const { outcome, model } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    expect(model.doGenerateCalls).toHaveLength(1);
    const checked = (outcome as { checkpoint: { document: Record<string, any> } }).checkpoint.document;
    expect(checked).toMatchObject({ billingPeriod: null, delivery: null, lines: [expect.objectContaining({ standardId: null })] });
  });

  it("keeps a required object that states nothing, so the schema reports it", async () => {
    const empty = { document: { ...invoice.document, seller: { name: "", street: "", city: "", postalZone: "", country: "" } }, findings: [], multipleDocuments: false };
    const { outcome } = await extractAndCheck("invoice", [empty, empty, empty, empty]);
    expect(outcome).toMatchObject({ failure: { code: "extraction_invalid", issues: [expect.objectContaining({ pointer: "/content/seller/country" })] } });
  });

  it("fails empty totals as missing evidence, without a repair", async () => {
    const document = { ...invoice.document, totals: { taxExclusiveAmount: "", taxInclusiveAmount: null, payableAmount: null } };
    const { outcome, model } = await extractAndCheck("invoice", [{ document, findings: [], multipleDocuments: false }]);
    expect(outcome).toMatchObject({ failure: { code: "insufficient_evidence", issues: [{ code: "missing_payable_amount" }] } });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  /** The sample invoice with its one line at another amount, which its quantity and price do not give. */
  const misread = (netAmount: string) => ({
    document: { ...invoice.document, lines: [{ ...invoice.document.lines[0], netAmount }] },
    findings: [],
    multipleDocuments: false,
  });
  const consistent = { document: invoice.document, findings: [], multipleDocuments: false };

  it("does not encode or validate an extracted document", async () => {
    const { outcome } = await extractAndCheck("invoice", [consistent]);
    expect(validatedXml).toHaveLength(0);
    expect(outcome).toEqual({ checkpoint: { document: expect.any(Object), findings: [] } });
  });

  it("repairs a document whose amounts do not add up, pointing at the values", async () => {
    const { outcome, model } = await extractAndCheck("invoice", [misread("90.00"), consistent]);
    expect(outcome).toEqual({ checkpoint: { document: expect.objectContaining({ invoiceNumber: invoice.number }), findings: [] } });
    expect(model.doGenerateCalls).toHaveLength(2);
    const repairPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(repairPrompt).toContain("/lines/0/netAmount: The line amount is 90.00, but quantity 2 × price 50.00 gives 100.00.");
    expect(repairPrompt).toContain("Keep a value that the document prints in the field where it belongs");
  });

  it("publishes a document whose amounts still do not add up after three repairs, with findings", async () => {
    const output = misread("90.00");
    const { outcome, model } = await extractAndCheck("invoice", [output, output, output, output]);
    expect(model.doGenerateCalls).toHaveLength(1 + MAX_REPAIR_CALLS);
    const findings = (outcome as { checkpoint: { findings: Record<string, unknown>[] } }).checkpoint.findings;
    expect(findings).toContainEqual({
      code: "inconsistent_amounts",
      severity: "warning",
      scope: "business",
      message: "The line amount is 90.00, but quantity 2 × price 50.00 gives 100.00.",
      pointer: "/content/lines/0/netAmount",
    });
  });

  it("keeps the output with the fewest discrepancies when a repair makes it worse", async () => {
    const broken = { document: { ...invoice.document, lines: [] }, findings: [], multipleDocuments: false };
    const { outcome, model } = await extractAndCheck("invoice", [misread("90.00"), broken, broken, broken]);
    expect(model.doGenerateCalls).toHaveLength(1 + MAX_REPAIR_CALLS);
    expect(outcome).toMatchObject({ checkpoint: { document: { lines: [{ netAmount: "90.00" }] } } });
  });

  it("corrects a base quantity without a repair call, and reports the correction", async () => {
    const perHundred = {
      ...consistent,
      document: { ...invoice.document, lines: [{ ...invoice.document.lines[0], quantity: "200", baseQuantity: null }] },
    };
    const { outcome, model } = await extractAndCheck("invoice", [perHundred]);
    expect(model.doGenerateCalls).toHaveLength(1);
    const checkpoint = (outcome as { checkpoint: { document: Record<string, any>; findings: { code: string }[] } }).checkpoint;
    expect(checkpoint.document.lines[0].baseQuantity).toBe("100");
    expect(checkpoint.findings.map((finding) => finding.code)).toEqual(["corrected_value"]);
  });

  it("asks for an empty string instead of a placeholder for a value that is not printed", async () => {
    const { model } = await extractAndCheck("invoice", [consistent]);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Write an empty string for a required text field whose value is not printed");
    expect(prompt).toContain("Never write a placeholder such as <UNKNOWN>");
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
    const output = { document, findings: [], multipleDocuments: false };
    const { outcome } = await extractAndCheck("invoice", [output, output, output, output]);
    const codes = (outcome as { checkpoint: { findings: { code: string }[] } }).checkpoint.findings.map((finding) => finding.code);
    expect(codes).toContain("receiver_mismatch");
    expect(codes).toContain("inconsistent_amounts");
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

describe("orders and delivery notes", () => {
  const order = sampleDocument("order");
  const despatchAdvice = sampleDocument("despatchAdvice");
  const output = (document: unknown) => ({ document, findings: [], multipleDocuments: false });
  type Checked = { document: Record<string, any>; findings: Record<string, unknown>[] };
  const checked = (outcome: unknown) => (outcome as { checkpoint: Checked }).checkpoint;

  it.each(OPERATIONAL_SAMPLE_TYPES)("runs the generic stages for %s, with its own rules and not those of billing", async (type) => {
    const sample = sampleDocument(type);
    const { outcome, model } = await extractAndCheck(type, [output(sample.document)]);
    expect(outcome).toEqual({ checkpoint: { document: expect.any(Object), findings: [] } });
    expect(sample.documentType.extractDocumentNumber(checked(outcome).document)).toBe(sample.number);
    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).not.toContain("Use VAT category S only with a rate above 0.");
    expect(prompt).not.toContain("paymentMeans");
    expect(prompt).toContain(type === "order" ? "The buyer issues the order." : "A delivery note states no prices or amounts.");
  });

  describe("order", () => {
    it("accepts an order without prices, VAT or totals, without a repair and without the checks of billing", async () => {
      const lines = order.document.lines.map(({ netPriceAmount: _price, netAmount: _amount, vat: _vat, ...line }: Record<string, unknown>) => line);
      const { outcome, model } = await extractAndCheck("order", [output({ ...order.document, lines, totals: null, vat: null })]);
      expect(model.doGenerateCalls).toHaveLength(1);
      expect(checked(outcome).findings).toEqual([]);
      expect(checked(outcome).document.lines[0]).toMatchObject({ quantity: "40", sellersId: "FL-55" });
      expect(checked(outcome).document.lines[0].netPriceAmount).toBeUndefined();
    });

    it("keeps the delivery address, the requested delivery date and the issuer as the buyer", async () => {
      const { outcome } = await extractAndCheck("order", [output(order.document)]);
      const document = checked(outcome).document;
      expect(document.delivery).toMatchObject({
        recipientName: "Bakkerij Janssens Atelier",
        location: { street: "Industrieweg 12", city: "Gent", country: "BE" },
        requestedPeriod: { startDate: "2026-11-27", endDate: "2026-11-27" },
      });
      expect(getDocumentType("order")!.extractCounterparties(document)).toEqual({
        senderName: "Bakkerij Janssens BV",
        receiverName: "Recommand E2E Buyer",
      });
    });

    it("leaves out a requested delivery period without a date and a VAT entry without a category, without a repair", async () => {
      const document = {
        ...order.document,
        delivery: { ...order.document.delivery, requestedPeriod: { startDate: null, endDate: "" } },
        lines: order.document.lines.map((line: Record<string, unknown>, index: number) =>
          index === 1 ? { ...line, vat: { category: null, percentage: null }, requestedDeliveryPeriod: {} } : line,
        ),
        vat: null,
        totals: { ...order.document.totals, taxInclusiveAmount: null, payableAmount: order.document.totals.taxExclusiveAmount },
      };
      const { outcome, model } = await extractAndCheck("order", [output(document)]);
      expect(model.doGenerateCalls).toHaveLength(1);
      expect(checked(outcome).document.delivery.requestedPeriod).toBeNull();
      expect(checked(outcome).document.lines[1]).toMatchObject({ vat: null, requestedDeliveryPeriod: null });
    });

    it("repairs a line amount that is not its quantity times its price, and reports it when it stays", async () => {
      const misread = output({
        ...order.document,
        lines: [{ ...order.document.lines[0], netAmount: "700.00" }, order.document.lines[1]],
      });
      const { outcome, model } = await extractAndCheck("order", [misread, misread, misread, misread]);
      expect(model.doGenerateCalls).toHaveLength(1 + MAX_REPAIR_CALLS);
      expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
        "/lines/0/netAmount: The line amount is 700.00, but quantity 40 × price 18.50 gives 740.00.",
      );
      expect(checked(outcome).findings).toContainEqual({
        code: "inconsistent_amounts",
        severity: "warning",
        scope: "business",
        message: "The line amount is 700.00, but quantity 40 × price 18.50 gives 740.00.",
        pointer: "/content/lines/0/netAmount",
      });
    });

    it("reports an order that is placed with another company", async () => {
      const document = { ...order.document, seller: { ...order.document.seller, name: "Other Supplier NV" } };
      const { outcome } = await extractAndCheck("order", [output(document)]);
      expect(checked(outcome).findings.map((finding) => finding.code)).toEqual(["receiver_mismatch"]);
    });

    it("fails an order without the name of its buyer, which issued it", async () => {
      const document = { ...order.document, buyer: { ...order.document.buyer, name: "" } };
      const { outcome, model } = await extractAndCheck("order", [output(document)]);
      expect(outcome).toMatchObject({ failure: { code: "insufficient_evidence", issues: [{ code: "missing_sender" }] } });
      expect(model.doGenerateCalls).toHaveLength(1);
    });
  });

  describe("delivery note", () => {
    it("keeps the delivered and outstanding quantities and the references to the order, and states no amounts", async () => {
      const { outcome } = await extractAndCheck("despatchAdvice", [output(despatchAdvice.document)]);
      const document = checked(outcome).document;
      expect(document.orderReference).toBe("PO-2026-0042");
      expect(document.lines[0]).toMatchObject({
        quantity: "30",
        outstandingQuantity: "10",
        outstandingReason: "Out of stock",
        orderLineReference: "1",
        itemInstances: [expect.objectContaining({ lotNumber: "L2026-311" })],
      });
      expect(document.totals).toBeUndefined();
    });

    it("writes a registration number under a scheme without dots, and leaves out a carrier that states nothing", async () => {
      const document = {
        ...despatchAdvice.document,
        despatchParty: { ...despatchAdvice.document.despatchParty, partyIdentifiers: [{ identifier: "0403.201.185", scheme: "0208" }] },
        consignee: { ...despatchAdvice.document.consignee, partyIdentifiers: [{ identifier: "K-10.442" }] },
        shipment: { ...despatchAdvice.document.shipment, carrier: { name: "", identifier: null } },
      };
      const { outcome, model } = await extractAndCheck("despatchAdvice", [output(document)]);
      expect(model.doGenerateCalls).toHaveLength(1);
      const result = checked(outcome).document;
      expect(result.despatchParty.partyIdentifiers).toEqual([{ identifier: "0403201185", scheme: "0208" }]);
      // A number without a scheme, such as a customer number, stays as printed.
      expect(result.consignee.partyIdentifiers).toEqual([{ identifier: "K-10.442" }]);
      expect(result.shipment.carrier).toBeNull();
    });

    it("repairs a negative quantity", async () => {
      const negative = output({ ...despatchAdvice.document, lines: [{ ...despatchAdvice.document.lines[0], quantity: "-30" }] });
      const { outcome, model } = await extractAndCheck("despatchAdvice", [negative, output(despatchAdvice.document)]);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("/lines/0/quantity: The quantity -30 is negative.");
      expect(checked(outcome).findings).toEqual([]);
    });

    it("fails a line without an article number, and tells the model not to invent one", async () => {
      const line = { ...despatchAdvice.document.lines[0], sellersId: null, standardId: null };
      const withoutArticle = output({ ...despatchAdvice.document, lines: [line] });
      const { outcome, model } = await extractAndCheck("despatchAdvice", [withoutArticle, withoutArticle, withoutArticle, withoutArticle]);
      expect(outcome).toMatchObject({
        failure: { code: "extraction_invalid", issues: [expect.objectContaining({ pointer: "/content/lines/0" })] },
      });
      expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("never add a value that the document does not print");
    });

    it("fails a delivery note without the name of its despatch party, which issued it", async () => {
      const document = { ...despatchAdvice.document, despatchParty: { ...despatchAdvice.document.despatchParty, name: "" } };
      const { outcome } = await extractAndCheck("despatchAdvice", [output(document)]);
      expect(outcome).toMatchObject({ failure: { code: "insufficient_evidence", issues: [{ code: "missing_sender" }] } });
    });

    it("reports a delivery note for another consignee", async () => {
      const document = { ...despatchAdvice.document, consignee: { ...despatchAdvice.document.consignee, name: "Somebody Else" } };
      const { outcome } = await extractAndCheck("despatchAdvice", [output(document)]);
      expect(checked(outcome).findings.map((finding) => finding.code)).toEqual(["receiver_mismatch"]);
    });
  });

  describe("publication", () => {
    /** The envelope of an extracted document of a type, after extract and check. */
    async function envelopeOf(type: "order" | "despatchAdvice") {
      const sample = sampleDocument(type);
      const { outcome, run } = await extractAndCheck(type, [output(sample.document)]);
      return { envelope: await resultEnvelope(run, sample.documentType, checked(outcome).document), sample };
    }

    it("records an extracted order without XML, in the order format, from the buyer", async () => {
      const { envelope } = await envelopeOf("order");
      const format = getDocumentFormat("peppol-ubl-order")!;
      expect(envelope).toMatchObject({ xml: null, docTypeId: format.docTypeId, processId: format.supportedProcessIds[0] });
      expect(envelope.senderId).toBe("0208:0123456749");
      expect(envelope.sender).toMatchObject({ name: "Bakkerij Janssens BV", country: "BE" });
      expect((envelope.document as { attachments: { mimeCode: string }[] }).attachments).toEqual([
        expect.objectContaining({ mimeCode: "application/pdf" }),
      ]);
    });

    it("gives an extracted delivery note the address of the despatch party's identifier", async () => {
      const { envelope } = await envelopeOf("despatchAdvice");
      const format = getDocumentFormat("peppol-ubl-despatch-advice")!;
      expect(envelope).toMatchObject({ xml: null, docTypeId: format.docTypeId, senderId: "0208:0403201185" });
    });

    it.each(OPERATIONAL_SAMPLE_TYPES)("gives a %s that the UBL format of its type writes and reads back", async (type) => {
      const { envelope, sample } = await envelopeOf(type as "order" | "despatchAdvice");
      const format = getDocumentFormatsByDocumentTypeKey(type)[0];
      const processId = resolveFormatProcessId(format, envelope.document);
      const xml = format.encode(envelope.document as never, processId, {
        senderAddress: envelope.senderId,
        recipientAddress: "0208:0598726857",
        isDocumentValidationEnforced: true,
      });
      const decoded = sample.documentType.documentSchema.parse(format.decode(xml, processId));
      expect(sample.documentType.extractDocumentNumber(decoded)).toBe(sample.number);
      expect(decoded.lines).toHaveLength(sample.document.lines.length);
    });
  });
});
