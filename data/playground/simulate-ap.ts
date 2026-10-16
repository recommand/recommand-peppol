import { UserFacingError } from "@peppol/utils/util";
import { receivingPipeline } from "@peppol/utils/pipelines/receiving";
import { normalizeProcessId } from "@peppol/utils/parsing/process-id";
import { getRecipientCapabilities } from "@peppol/data/recipient-capabilities";
import {
  isReservedUnknownRecipient,
  normalizeDocTypeId,
  playgroundRecipientAccepts,
  resolvePlaygroundAddress,
} from "./recipients";

/**
 * The playground's counterpart of a recipient the network does not know: a send to
 * an address no playground company and no production participant answers to, or to
 * one of the addresses reserved for it, fails the way a lookup of an unregistered
 * participant would.
 */
export class PlaygroundRecipientNotFoundError extends UserFacingError {}

/**
 * The playground's counterpart of a recipient that is registered, but not for this
 * document type under this process.
 */
export class PlaygroundDocumentNotSupportedError extends UserFacingError {}

/**
 * Stand in for the access point in a playground that is not on the test network. The
 * recipient is looked up as production would look it up, so the send succeeds or fails
 * as it would there; see isSimulatedPlayground. Only a company in this playground team
 * then receives the document. A production participant is looked up and nothing more:
 * no document leaves the playground.
 */
export async function simulateSendAs4(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: BodyInit;
  contentType?: string;

  playgroundTeamId: string;
}) {
  if (isReservedUnknownRecipient(options.receiverId)) {
    throw new PlaygroundRecipientNotFoundError("This document was sent to recipient 404:404 or 0208:1234567894, simulating the sending of a document to a Peppol address that does not exist.");
  }

  const playgroundAddress = await resolvePlaygroundAddress({
    recipientAddress: options.receiverId,
    playgroundTeamId: options.playgroundTeamId,
  });
  if (playgroundAddress?.kind === "unknown") {
    throw new PlaygroundRecipientNotFoundError(`Recipient ${options.receiverId} is not a valid Peppol address.`);
  }

  if (playgroundAddress?.kind === "company") {
    if (!playgroundRecipientAccepts(playgroundAddress.recipient, options.docTypeId, options.processId)) {
      throw new PlaygroundDocumentNotSupportedError(notSupportedMessage(options));
    }
  } else {
    const capabilities = await getRecipientCapabilities({
      recipientAddress: options.receiverId,
      isPlayground: false,
      useTestNetwork: false,
      teamId: options.playgroundTeamId,
    });
    // An unregistered participant and an SMP that could not be reached look the same
    // from here, so the message claims neither.
    if (!capabilities) {
      throw new PlaygroundRecipientNotFoundError(`Recipient ${options.receiverId} could not be found on the Peppol network.`);
    }
    const docTypeId = normalizeDocTypeId(options.docTypeId);
    const processIds = capabilities.supportsDocType(docTypeId)
      ? await capabilities.getProcessIds(docTypeId)
      : [];
    if (!processIds.includes(normalizeProcessId(options.processId))) {
      throw new PlaygroundDocumentNotSupportedError(notSupportedMessage(options));
    }
    return;
  }

  await receivingPipeline({
    senderId: options.senderId,
    receiverId: options.receiverId,
    docTypeId: options.docTypeId,
    processId: options.processId,
    countryC1: options.countryC1,
    body: options.body,
    contentType: options.contentType,
    skipBilling: true,
    playgroundTeamId: options.playgroundTeamId,
  });
}

function notSupportedMessage(options: { receiverId: string; docTypeId: string; processId: string }): string {
  return `Recipient ${options.receiverId} is not registered to receive document type ${options.docTypeId} under process ${normalizeProcessId(options.processId)}.`;
}
