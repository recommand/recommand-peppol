import { getCompanyByPeppolId } from "@peppol/data/companies";
import { DOCUMENT_SCHEME, PROCESS_SCHEME } from "@peppol/data/phoss-smp/service-metadata";
import {
  recordIncomingDocument,
  runIncomingDocumentFollowUps,
} from "@peppol/data/record-incoming-document";
import { UserFacingError } from "@peppol/utils/util";
import { prepareIncomingDocument } from "./prepare-document";
import type { ReceivingPipelineInput } from "./types";

export async function receivingPipeline(
  options: ReceivingPipelineInput,
) {
  const senderId = options.senderId.startsWith("iso6523-actorid-upis::")
    ? options.senderId.split("::")[1]
    : options.senderId;
  const receiverId = options.receiverId.startsWith("iso6523-actorid-upis::")
    ? options.receiverId.split("::")[1]
    : options.receiverId;

  const company = await getCompanyByPeppolId({
    peppolId: receiverId,
    playgroundTeamId: options.playgroundTeamId,
    useTestNetwork: options.useTestNetwork,
  });
  if (!company) {
    throw new UserFacingError("Company not found");
  }

  const documentSchemePrefix = `${DOCUMENT_SCHEME}::`;
  const docTypeId = options.docTypeId.startsWith(documentSchemePrefix)
    ? options.docTypeId.substring(documentSchemePrefix.length)
    : options.docTypeId;
  const processSchemePrefix = `${PROCESS_SCHEME}::`;
  const processId = options.processId.startsWith(processSchemePrefix)
    ? options.processId.substring(processSchemePrefix.length)
    : options.processId;

  const received = await prepareIncomingDocument({
    docTypeId,
    processId,
    body: options.body,
    contentType: options.contentType,
    company,
    senderId,
  });

  const documentId = await recordIncomingDocument({
    received,
    company,
    skipBilling: options.skipBilling,
    source: {
      channel: "peppol",
      senderId,
      receiverId,
      docTypeId,
      processId,
      countryC1: options.countryC1,
      as4MessageId: options.as4MessageId,
      as4ConversationId: options.as4ConversationId,
      sbdhInstanceIdentifier: options.sbdhInstanceIdentifier,
      apTransactionId: options.apTransactionId,
    },
  });

  await runIncomingDocumentFollowUps({
    documentId,
    received,
    company,
    senderId,
    isPlayground: options.useTestNetwork || options.playgroundTeamId ? true : false,
  });
}

export type {
  IncomingOriginalPayload,
  PreparedIncomingDocument,
  ReceivingPipelineInput,
} from "./types";
