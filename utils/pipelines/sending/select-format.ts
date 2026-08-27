import type { AccessPointProviderId } from "@peppol/data/peppol-providers";
import type { RecipientCapabilities } from "@peppol/data/recipient-capabilities";
import { normalizeProcessId } from "@peppol/utils/parsing/process-id";
import {
  getDocumentFormatByDocTypeId,
  getDocumentFormatsByDocumentTypeKey,
  resolveFormatProcessId,
  resolveFormatProcessIdCandidates,
} from "@peppol/utils/type-repository/document-formats";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { SendingFailure } from "./errors";
import { isFranceRegulatedSendingSupported } from "./france-regulated-guard";

export type FormatSelection = {
  format: AnyDocumentFormat;
  processId: string;
  /**
   * Set when the recipient was looked up and turned out not to be registered for
   * anything we can send this document as. The selection then falls back to the default
   * format, so the document still exists for email delivery, and the caller skips the
   * Peppol transmission that would only fail at the far end.
   */
  peppolRoutingFailure?: string;
};

/**
 * Decide which document type identifier and process a JSON document is sent as.
 *
 * A caller that names both is taken at its word. Where either is left open, and the
 * recipient's receiving capabilities could be looked up, the first combination the
 * recipient is actually registered for wins: document formats are tried in the order the
 * registry declares them and processes in the order the format declares them, both of
 * which state their priority. Without a lookup, the first format and the process the
 * document selects are used, which is what sending did before autorouting existed.
 */
export async function selectFormatAndProcess(options: {
  documentType: AnyDocumentType;
  document: unknown;
  recipientAddress: string | null;
  doctypeId?: string;
  processId?: string;
  company: { country: string; accessPointProvider: AccessPointProviderId };
  isPlayground: boolean;
  capabilities: RecipientCapabilities | null;
}): Promise<FormatSelection> {
  const { documentType, document, company, isPlayground, capabilities } = options;

  const formats = getDocumentFormatsByDocumentTypeKey(documentType.key);
  const requestedFormat = options.doctypeId
    ? getDocumentFormatByDocTypeId(options.doctypeId)
    : undefined;
  if (options.doctypeId && (!requestedFormat || !formats.includes(requestedFormat))) {
    throw new SendingFailure(
      `Document type identifier is not supported for ${documentType.key}.`,
      400,
    );
  }

  const requestedProcessId = options.processId
    ? normalizeProcessId(options.processId)
    : undefined;

  let candidateFormats = requestedFormat ? [requestedFormat] : formats;
  if (requestedProcessId) {
    // Unlike raw XML, where the process id only names the process the document travels
    // over, here it is written into the document we generate as its profile identifier.
    // An unsupported one therefore produces a document the network refuses, so say which
    // field is at fault instead of letting it come back as a list of failed validation
    // rules.
    candidateFormats = candidateFormats.filter((format) =>
      format.supportedProcessIds.includes(requestedProcessId),
    );
    if (candidateFormats.length === 0) {
      throw new SendingFailure(
        `Process identifier is not supported for ${documentType.key}.`,
        400,
      );
    }
  }

  const defaultFormat = candidateFormats[0];
  if (!defaultFormat) {
    throw new SendingFailure(
      `Document type identifier is not supported for ${documentType.key}.`,
      400,
    );
  }
  const defaultSelection: FormatSelection = {
    format: defaultFormat,
    processId:
      requestedProcessId ?? resolveFormatProcessId(defaultFormat, document),
  };

  if ((requestedFormat && requestedProcessId) || !capabilities) {
    return defaultSelection;
  }

  for (const format of candidateFormats) {
    if (!capabilities.supportsDocType(format.docTypeId)) continue;

    const registeredProcessIds = await capabilities.getProcessIds(
      format.docTypeId,
    );
    const processIds = requestedProcessId
      ? [requestedProcessId]
      : resolveFormatProcessIdCandidates(format, document);

    for (const processId of processIds) {
      if (!registeredProcessIds.includes(processId)) continue;
      // A combination this company may not send over is not one to route it over: it
      // would be turned down before it ever reached the recipient.
      if (
        !isFranceRegulatedSendingSupported({
          docTypeId: format.docTypeId,
          processId,
          company,
          isPlayground,
        })
      ) {
        continue;
      }
      return { format, processId };
    }
  }

  return {
    ...defaultSelection,
    peppolRoutingFailure: `Recipient ${options.recipientAddress} is not registered to receive ${documentType.translatableTitle.toLowerCase()} documents in any format this company can send.`,
  };
}
