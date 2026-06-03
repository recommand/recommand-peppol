import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  DOCUMENT_XML_HANDLERS,
  type DocumentXmlHandler,
} from "../utils/parsing/document-handlers";
import type { SupportedDocumentType } from "../utils/document-types";
import type { ParsedDocument } from "../utils/document-filename";
import { FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO } from "../utils/document-types";
import { resolveOutgoingDocumentXmlHandler } from "../utils/outgoing-document-payload";
import { creditNoteSchema, type CreditNote } from "../utils/parsing/creditnote/schemas";
import { invoiceSchema, type Invoice } from "../utils/parsing/invoice/schemas";
import {
  calculateLineAmount,
  calculateTotals,
  calculateVat,
} from "../utils/parsing/invoice/calculations";
import { messageLevelResponseSchema } from "../utils/parsing/message-level-response/schemas";
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
} satisfies Record<Exclude<SupportedDocumentType, "unknown">, z.ZodTypeAny>;

type SchemaDocumentType = keyof typeof schemasByType;
type BillingDocument = Invoice | CreditNote | SelfBillingInvoice | SelfBillingCreditNote;

function hasSchemaFor(type: SupportedDocumentType): type is SchemaDocumentType {
  return type in schemasByType;
}

function valueForPath(path: string[]): unknown {
  const field = path.at(-1) ?? "";
  const joined = path.join(".");

  if (field === "country" || field === "originCountry") return "BE";
  if (field === "issueDate" || field === "dueDate" || field === "date") return "2025-01-01";
  if (field === "email") return "schema@example.com";
  if (field === "phone") return "+32123456789";
  if (field === "vatNumber") return joined.includes("buyer") ? "BE9876543210" : "BE1234567894";
  if (field === "enterpriseNumber") return joined.includes("buyer") ? "9876543210" : "1234567894";
  if (field === "enterpriseNumberScheme" || field === "scheme") return "0208";
  if (field === "identifier") return "1234567894";
  if (field === "paymentMethod") return "credit_transfer";
  if (field === "iban") return "BE1234567890";
  if (field === "financialInstitutionBranch") return "GEBABEBB";
  if (field === "currency") return "EUR";
  if (field === "category") return "S";
  if (field === "percentage") return "21.00";
  if (field === "unitCode") return "C62";
  if (field === "quantity" || field === "baseQuantity") return "2";
  if (field.endsWith("Amount") || field === "amount") return "10.00";
  if (field === "mimeCode") return "text/plain";
  if (field === "filename") return "schema.txt";
  if (field === "embeddedDocument") return "SGVsbG8=";
  if (field === "url") return "https://example.com/schema.txt";
  if (field === "responseCode") return "AP";
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

  const generated = schema.parse(sampleFromSchema(schema)) as ParsedDocument;
  if (type === "messageLevelResponse") return generated;
  return schema.parse(normalizeBillingDocument(generated as BillingDocument)) as ParsedDocument;
}

function handlersForType(type: SchemaDocumentType): DocumentXmlHandler[] {
  const handlers = DOCUMENT_XML_HANDLERS.filter((handler) => handler.type === type);
  if (type !== "invoice") {
    return handlers;
  }

  const facturXResolution = resolveOutgoingDocumentXmlHandler(
    FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    "invoice"
  );
  if (!facturXResolution.ok) {
    throw new Error(facturXResolution.message);
  }

  return [
    ...handlers,
    {
      ...facturXResolution.resolution.handler,
      title: "France Factur-X CII Invoice",
    },
  ];
}

// Types that must round-trip through both their UBL and CII (D22B) handlers.
const minimumHandlerCount: Partial<Record<SchemaDocumentType, number>> = {
  invoice: 3,
  creditNote: 2,
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
          const document = generatedDocumentFor(type);
          const { parsed, reparsed } = roundTripHandler(handler, document);

          expect(parsed, handler.title).toEqual(document);
          expect(reparsed, handler.title).toEqual(parsed);
        });
      }

      if (handlers.length > 1) {
        it("handlers produce equivalent parsed documents", () => {
          const document = generatedDocumentFor(type);
          const parsedDocuments = handlers.map(
            (handler) => roundTripHandler(handler, document).parsed
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
