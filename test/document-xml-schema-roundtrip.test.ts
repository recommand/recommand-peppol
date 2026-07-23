import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  DOCUMENT_XML_HANDLERS,
  type DocumentXmlHandler,
} from "../utils/parsing/document-handlers";
import type { SupportedDocumentType } from "../utils/document-types";
import type { ParsedDocument } from "../utils/document-filename";
import {
  FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
} from "../utils/document-types";
import { resolveOutgoingDocumentXmlHandler } from "../utils/outgoing-document-payload";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { invoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import {
  calculateLineAmount,
  calculateTotals,
  calculateVat,
} from "../utils/parsing/invoice/calculations";
import { messageLevelResponseSchema } from "../utils/parsing/message-level-response/schemas";
import { franceCdarSchema } from "../utils/parsing/france-cdar/schemas";
import {
  selfBillingCreditNoteSchema,
  type SelfBillingCreditNote,
} from "../utils/parsing/self-billing-creditnote/schemas";
import {
  selfBillingInvoiceSchema,
  type SelfBillingInvoice,
} from "../utils/parsing/self-billing-invoice/schemas";

const senderAddress = "0208:0428643097";
const recipientAddress = "0208:0598726857";

const schemasByType = {
  invoice: invoiceSchema,
  creditNote: creditNoteSchema,
  selfBillingInvoice: selfBillingInvoiceSchema,
  selfBillingCreditNote: selfBillingCreditNoteSchema,
  messageLevelResponse: messageLevelResponseSchema,
  frenchInvoicingCdar: franceCdarSchema,
} satisfies Record<Exclude<SupportedDocumentType, "unknown">, z.ZodTypeAny>;

type SchemaDocumentType = keyof typeof schemasByType;
type BillingDocument = Invoice | CreditNote | SelfBillingInvoice | SelfBillingCreditNote;

function hasSchemaFor(type: SupportedDocumentType): type is SchemaDocumentType {
  return type in schemasByType;
}

function valueForPath(path: string[]): unknown {
  const field = path.at(-1) ?? "";
  const joined = path.join(".");

  if (field === "country" || field === "originCountry") return "FR";
  if (
    field === "issueDate" ||
    field === "invoiceIssueDate" ||
    field === "dueDate" ||
    field === "date"
  ) {
    return "2025-01-01";
  }
  if (field === "email") return "schema@example.com";
  if (field === "phone") return "+32123456789";
  if (field === "vatNumber") return joined.includes("buyer") ? "FR23341815675" : "FR40303265045";
  if (field === "enterpriseNumber") return joined.includes("buyer") ? "341815675" : "303265045";
  if (field === "enterpriseNumberScheme") return "0002";
  if (field === "scheme") return "0208";
  if (field === "identifier") return "1234567894";
  if (field === "paymentMethod") return "credit_transfer";
  if (field === "iban") return "BE1234567890";
  if (field === "financialInstitutionBranch") return "GEBABEBB";
  if (field === "currency") return "EUR";
  if (field === "category") return "S";
  if (field === "percentage") return "20.00";
  if (field === "unitCode") return "C62";
  if (field === "quantity" || field === "baseQuantity") return "2";
  if (field.endsWith("Amount") || field === "amount") return "10.00";
  if (field === "mimeCode") return "text/plain";
  if (field === "filename") return "schema.txt";
  if (field === "embeddedDocument") return "SGVsbG8=";
  if (field === "url") return "https://example.com/schema.txt";
  if (field === "responseCode") return "AP";
  if (field === "phase") return "23";
  if (field === "businessProcess") return "REGULATED";
  if (field === "statusCode") return "205";
  if (field === "senderRole") return "BY";
  if (field === "issuerRole") return "BY";
  if (field === "recipientRole") return "SE";
  if (field === "issuerLegalId" || field === "sellerLegalId" || field === "recipientLegalId") {
    return "123456789";
  }
  if (
    field === "issuerLegalIdScheme" ||
    field === "sellerLegalIdScheme" ||
    field === "recipientLegalIdScheme"
  ) {
    return "0002";
  }
  if (field === "recipientElectronicAddress") return "123456789_STATUTS";
  if (field === "recipientElectronicAddressScheme") return "0225";
  if (field === "vatPercent") return "20.00";
  if (field === "schemeVersion") return "1.0";
  if (field === "value") return "Schema value";

  return `${field || "value"}-schema`;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault) return unwrap(schema._def.innerType);
  if (schema instanceof z.ZodOptional) return unwrap(schema._def.innerType);
  if (schema instanceof z.ZodNullable) return unwrap(schema._def.innerType);
  if (schema instanceof z.ZodEffects) return unwrap(schema._def.schema);
  if (schema instanceof z.ZodBranded) return unwrap(schema._def.type);
  return schema;
}

function sampleFromSchema(schema: z.ZodTypeAny, path: string[] = []): unknown {
  const unwrapped = unwrap(schema);

  if (unwrapped instanceof z.ZodObject) {
    return Object.fromEntries(
      Object.entries(unwrapped.shape).map(([key, value]) => [
        key,
        sampleFromSchema(value as z.ZodTypeAny, [...path, key]),
      ])
    );
  }

  if (unwrapped instanceof z.ZodArray) {
    return [sampleFromSchema(unwrapped._def.type, [...path, "0"])];
  }

  if (unwrapped instanceof z.ZodUnion) {
    return sampleFromSchema(unwrapped._def.options[0], path);
  }

  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    return sampleFromSchema(unwrapped._def.options[0], path);
  }

  if (unwrapped instanceof z.ZodEnum) {
    const preferredValue = valueForPath(path);
    return unwrapped.options.includes(preferredValue as string)
      ? preferredValue
      : unwrapped.options[0];
  }

  if (unwrapped instanceof z.ZodNativeEnum) {
    const values = Object.values(unwrapped._def.values).filter(
      (value) => typeof value === "string"
    );
    const preferredValue = valueForPath(path);
    return values.includes(preferredValue as string) ? preferredValue : values[0];
  }

  if (unwrapped instanceof z.ZodString) return valueForPath(path);
  if (unwrapped instanceof z.ZodNumber) return 10;
  if (unwrapped instanceof z.ZodBoolean) return true;
  if (unwrapped instanceof z.ZodLiteral) return unwrapped._def.value;

  return valueForPath(path);
}

function normalizeBillingDocument<T extends BillingDocument>(document: T): T {
  const lines = document.lines.map((line) => ({
    ...line,
    netAmount: calculateLineAmount(line),
  }));
  const withLines = { ...document, lines };
  const vat = calculateVat({ document: withLines, isDocumentValidationEnforced: false });
  const totals = calculateTotals({ ...withLines, vat, totals: undefined });

  return { ...withLines, vat, totals };
}

function generatedDocumentFor(type: SupportedDocumentType): ParsedDocument {
  if (!hasSchemaFor(type)) throw new Error(`No schema sample is available for ${type}`);

  const schema = schemasByType[type];

  const sample = sampleFromSchema(schema);
  if (type === "frenchInvoicingCdar") {
    const franceCdarSample = sample as Record<string, unknown>;
    Object.assign(franceCdarSample, {
      issueDate: "2025-01-01T12:00:00",
      invoiceIssueDate: "2025-01-01",
    });
    delete franceCdarSample.reasonCode;
    delete franceCdarSample.reason;
    delete franceCdarSample.reasonNote;
  }
  const generated = schema.parse(sample) as ParsedDocument;
  if (type === "messageLevelResponse" || type === "frenchInvoicingCdar") return generated;
  return schema.parse(normalizeBillingDocument(generated as BillingDocument)) as ParsedDocument;
}

function documentForHandler(
  handler: DocumentXmlHandler,
  document: ParsedDocument
): ParsedDocument {
  if (!("lines" in document)) return document;
  const {
    countrySpecific: _countrySpecific,
    ...sharedDocument
  } = document;
  if (!handler.title.includes("France")) return sharedDocument as ParsedDocument;
  return {
    ...sharedDocument,
    countrySpecific: {
      country: "FR",
      billingMode: "B1",
      recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
      latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
      earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
    },
  } as ParsedDocument;
}

function withoutCountrySpecific(document: ParsedDocument): ParsedDocument {
  if (!("lines" in document)) return document;
  const { countrySpecific: _countrySpecific, ...sharedDocument } = document;
  return sharedDocument as ParsedDocument;
}

function handlersForType(type: SchemaDocumentType): DocumentXmlHandler[] {
  const handlers = DOCUMENT_XML_HANDLERS.filter((handler) => handler.type === type);
  if (type !== "invoice" && type !== "creditNote") {
    return handlers;
  }

  const facturXDocTypeId =
    type === "invoice"
      ? FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId
      : FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO.docTypeId;
  const facturXResolution = resolveOutgoingDocumentXmlHandler(
    facturXDocTypeId,
    type
  );
  if (!facturXResolution.ok) {
    throw new Error(facturXResolution.message);
  }

  return [
    ...handlers,
    {
      ...facturXResolution.resolution.handler,
      title:
        type === "invoice"
          ? "France Factur-X CII Invoice"
          : "France Factur-X CII Credit Note",
    },
  ];
}

// Types that must round-trip through both their UBL and CII (D22B) handlers.
const minimumHandlerCount: Partial<Record<SchemaDocumentType, number>> = {
  invoice: 4,
  creditNote: 4,
};

function roundTripHandler(handler: DocumentXmlHandler, document: ParsedDocument) {
  const parsed = handler.fromXml(
    handler.toXml({
      document,
      senderAddress,
      recipientAddress,
      isDocumentValidationEnforced: false,
    })
  );
  const reparsed = handler.fromXml(
    handler.toXml({
      document: parsed,
      senderAddress,
      recipientAddress,
      isDocumentValidationEnforced: false,
    })
  );

  return { parsed, reparsed };
}

describe("document XML handlers schema-driven round-trip", () => {
  for (const type of Object.keys(schemasByType) as SchemaDocumentType[]) {
    const handlers = handlersForType(type);

    describe(type, () => {
      it(`registers at least ${minimumHandlerCount[type] ?? 1} handler(s)`, () => {
        expect(handlers.length, `${type} handlers`).toBeGreaterThanOrEqual(
          minimumHandlerCount[type] ?? 1
        );
      });

      for (const handler of handlers) {
        it(`round-trips via ${handler.title}`, () => {
          const document = documentForHandler(handler, generatedDocumentFor(type));
          const { parsed, reparsed } = roundTripHandler(handler, document);

          expect(parsed, handler.title).toEqual(document);
          expect(reparsed, handler.title).toEqual(parsed);
        });
      }

      if (handlers.length > 1) {
        it("handlers produce equivalent parsed documents", () => {
          const document = generatedDocumentFor(type);
          const parsedDocuments = handlers.map(
            (handler) =>
              withoutCountrySpecific(
                roundTripHandler(handler, documentForHandler(handler, document)).parsed
              )
          );

          const [firstDocument, ...otherDocuments] = parsedDocuments;
          for (const parsedDocument of otherDocuments) {
            expect(parsedDocument, `${type} handlers`).toEqual(firstDocument);
          }
        });
      }
    });
  }
});
