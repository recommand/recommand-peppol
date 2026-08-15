import { generateAndAttachRepositoryPdf } from "@peppol/utils/pdf-attachment-helper";
import { UserFacingError } from "@peppol/utils/util";
import { normalizeProcessId } from "@peppol/utils/parsing/process-id";
import {
  getDocumentFormatByDocTypeId,
  getDocumentFormatsByDocumentTypeKey,
  resolveFormatProcessId,
} from "@peppol/utils/type-repository/document-formats";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { SendingFailure } from "./errors";
import type { PreparedDocument, SendingContext, SendingInput } from "./types";

const NULL_RECIPIENT_ADDRESS = "0000:0000";

async function addGeneratedPdf(
  input: SendingInput,
  documentType: AnyDocumentType,
  format: AnyDocumentFormat,
  documentToRender: any,
  documentToAttachTo: any,
  documentId: string,
): Promise<any> {
  if (!documentType.pdfGeneration) {
    throw new SendingFailure(
      `PDF generation is not supported for ${documentType.key ?? "this document type"}.`,
      400,
    );
  }

  return generateAndAttachRepositoryPdf(
    documentId,
    documentType,
    documentToRender,
    documentToAttachTo,
    {
      customPdfFilename: input.pdfGeneration?.filename?.trim(),
      pdfa: format.container?.requiresPdfA,
    },
  );
}

function parseEncodedDocument(
  documentType: AnyDocumentType,
  format: AnyDocumentFormat,
  xml: string,
  processId: string,
  fallback: any,
): any {
  try {
    return documentType.documentSchema.parse(format.decode(xml, processId));
  } catch (error) {
    console.error(`Failed to parse ${format.translatableTitle} XML:`, error);
    return fallback;
  }
}

export async function prepareJsonDocument(options: {
  input: SendingInput;
  company: SendingContext["var"]["company"];
  senderAddress: string;
  recipientAddress: string | null;
  documentId: string;
  wrapContainer?: boolean;
}): Promise<PreparedDocument> {
  const {
    input,
    company,
    senderAddress,
    recipientAddress,
    documentId,
    wrapContainer = true,
  } = options;
  const documentType = getDocumentType(input.documentType);
  if (!documentType) {
    throw new SendingFailure("Invalid document type provided.", 400);
  }

  let document: any;
  try {
    document = documentType.documentSchema.parse(
      documentType.preprocessFromSendAPI(input, { company }),
    );
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new SendingFailure(
      `Invalid ${documentType.translatableTitle.toLowerCase()} data provided. The document you provided does not correspond to the required json object as laid out by our api reference. If unsure, don't hesitate to contact support@recommand.eu`,
      400,
    );
  }

  const formats = getDocumentFormatsByDocumentTypeKey(documentType.key);
  const format = input.doctypeId
    ? getDocumentFormatByDocTypeId(input.doctypeId)
    : formats[0];
  if (!format || !formats.includes(format)) {
    throw new SendingFailure(
      `Document type identifier is not supported for ${documentType.key}.`,
      400,
    );
  }

  const processId = input.processId
    ? normalizeProcessId(input.processId)
    : resolveFormatProcessId(format, document);
  const encode = (value: any) =>
    format.encode(value, processId, {
      senderAddress,
      recipientAddress: recipientAddress ?? NULL_RECIPIENT_ADDRESS,
      isDocumentValidationEnforced: true,
    });

  let xml = encode(document);
  let parsed = parseEncodedDocument(
    documentType,
    format,
    xml,
    processId,
    document,
  );
  if (input.pdfGeneration?.enabled) {
    document = await addGeneratedPdf(
      input,
      documentType,
      format,
      parsed,
      document,
      documentId,
    );
    xml = encode(document);
    parsed = parseEncodedDocument(
      documentType,
      format,
      xml,
      processId,
      document,
    );
  }

  let body: BodyInit = xml;
  let originalPayload: PreparedDocument["originalPayload"] = null;
  if (format.container && wrapContainer) {
    const container = await format.container.wrap({
      xmlDocument: xml,
      document: parsed,
    });
    const bytes = container.buffer.slice(
      container.byteOffset,
      container.byteOffset + container.byteLength,
    ) as ArrayBuffer;
    body = new Blob([bytes], { type: format.container.contentType });
    originalPayload = {
      content: container,
      containerFormat: format.container.containerFormat,
    };
  }

  return {
    type: documentType.key,
    parsed,
    xml,
    docTypeId: format.docTypeId,
    processId,
    body,
    contentType: format.container?.contentType ?? "application/xml",
    originalPayload,
  };
}
