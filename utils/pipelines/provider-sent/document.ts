import {
  DOCUMENT_SCHEME,
  PARTICIPANT_SCHEME,
  PROCESS_SCHEME,
} from "@peppol/data/phoss-smp/service-metadata";
import type { OutgoingDocumentDelivery } from "@peppol/data/outgoing-document-row";

/**
 * Strips the schemes an access point echoes back around the identifiers, which our
 * rows never store. The counterpart of what the receiving pipeline does for a
 * document coming from the network.
 */
export function normalizeProviderSentIdentifiers(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
}) {
  const strip = (value: string, prefix: string) =>
    value.startsWith(prefix) ? value.substring(prefix.length) : value;

  return {
    senderId: strip(options.senderId, `${PARTICIPANT_SCHEME}::`),
    receiverId: strip(options.receiverId, `${PARTICIPANT_SCHEME}::`),
    docTypeId: strip(options.docTypeId, `${DOCUMENT_SCHEME}::`),
    processId: strip(options.processId, `${PROCESS_SCHEME}::`),
  };
}

/**
 * The delivery of a document the access point put on the network itself: it left over
 * Peppol, without an email copy, and the transaction id is what a later provider
 * callback correlates against.
 */
export function providerSentDelivery(options: {
  apTransactionId: string;
  sbdhInstanceIdentifier?: string | null;
}): OutgoingDocumentDelivery {
  return {
    kind: "peppol",
    sentPeppol: true,
    emailRecipients: [],
    as4Response: {
      ok: true,
      peppolMessageId: null,
      peppolConversationId: null,
      receivedPeppolSignalMessage: null,
      sbdhInstanceIdentifier: options.sbdhInstanceIdentifier ?? null,
      apTransactionId: options.apTransactionId,
    },
  };
}
