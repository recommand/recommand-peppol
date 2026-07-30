import type { SendAs4Response } from "@peppol/data/phase4-ap/client";
import {
  DOCUMENT_SCHEME,
  PARTICIPANT_SCHEME,
  PROCESS_SCHEME,
} from "@peppol/data/phoss-smp/service-metadata";
import { verifyDocumentSupport } from "@peppol/data/recipient";
import {
  buildStandardBusinessDocument,
  type SbdhPayload,
} from "@peppol/utils/sbdh";
import { UserFacingError } from "@peppol/utils/util";
import { fetchArratechJson, getArratechConfig } from "./client";

// Arratech does not synchronously check receiver support before accepting a transaction, so
// we perform the SMP-level document type and process check ourselves.
async function checkReceiverSupportsDocumentType(options: {
  receiverId: string;
  docTypeId: string;
  processId: string;
  useTestNetwork: boolean;
}): Promise<void> {
  const { receiverId, docTypeId, processId, useTestNetwork } = options;

  try {
    await verifyDocumentSupport({
      recipientAddress: receiverId,
      documentType: docTypeId,
      processId,
      useTestNetwork,
    });
  } catch {
    const encodedProcessId = processId.includes("::")
      ? processId
      : `${PROCESS_SCHEME}::${processId}`;
    throw new UserFacingError(
      `Failed to resolve SMP endpoint (${PARTICIPANT_SCHEME}::${receiverId}, ${DOCUMENT_SCHEME}::${docTypeId}, ${encodedProcessId})`
    );
  }
}

async function toSbdhPayload(
  body: BodyInit,
  contentType: string | undefined
): Promise<SbdhPayload> {
  if (typeof body === "string") {
    return { kind: "xml", xml: body };
  }
  if (body instanceof Blob) {
    return {
      kind: "binary",
      base64Content: Buffer.from(await body.arrayBuffer()).toString("base64"),
      mimeType: contentType ?? body.type ?? "application/octet-stream",
    };
  }
  throw new Error("Unsupported document body type for AT access point");
}

export async function sendAs4(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: BodyInit;
  contentType?: string;
  useTestNetwork: boolean;
}): Promise<SendAs4Response> {
  const config = getArratechConfig(options.useTestNetwork);

  // The SBDH carries the process id and its scheme separately, so split a qualified id
  // rather than assuming the default scheme. Document type ids are left alone: they
  // contain "::" themselves and Peppol fixes their scheme.
  const processSchemeSeparator = options.processId.indexOf("::");
  const processIdScheme =
    processSchemeSeparator === -1
      ? PROCESS_SCHEME
      : options.processId.substring(0, processSchemeSeparator);
  const processId =
    processSchemeSeparator === -1
      ? options.processId
      : options.processId.substring(processSchemeSeparator + 2);

  try {
    await checkReceiverSupportsDocumentType({
      receiverId: options.receiverId,
      docTypeId: options.docTypeId,
      processId: options.processId,
      useTestNetwork: options.useTestNetwork,
    });

    // Arratech expects a full Standard Business Document (SBDH envelope +
    // payload), not the bare business document.
    const standardBusinessDocument = buildStandardBusinessDocument({
      senderId: options.senderId,
      receiverId: options.receiverId,
      docTypeId: options.docTypeId,
      processId,
      countryC1: options.countryC1,
      documentIdScheme: DOCUMENT_SCHEME,
      processIdScheme,
      payload: await toSbdhPayload(options.body, options.contentType),
    });

    const searchParams = new URLSearchParams({ ap: config.apRef });
    const { transactionId } = await fetchArratechJson<{ transactionId: string }>(
      `/orgs/${config.orgId}/transactions?${searchParams.toString()}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
        },
        body: standardBusinessDocument.xml,
        useTestNetwork: options.useTestNetwork,
      }
    );

    return {
      ok: true,
      peppolMessageId: null,
      peppolConversationId: null,
      receivedPeppolSignalMessage: null,
      sbdhInstanceIdentifier: standardBusinessDocument.instanceIdentifier,
      apTransactionId: transactionId ?? null,
    };
  } catch (error) {
    console.error("Failed to send document via Arratech AP:", error);
    return {
      ok: false,
      peppolMessageId: null,
      peppolConversationId: null,
      receivedPeppolSignalMessage: null,
      sbdhInstanceIdentifier: null,
      apTransactionId: null,
      sendingException: {
        message:
          error instanceof Error
            ? error.message
            : "Failed to send document via AT access point",
      },
    };
  }
}
