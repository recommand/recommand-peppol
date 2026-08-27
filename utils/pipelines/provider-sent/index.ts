import { findCompanyByPeppolId } from "@peppol/data/companies";
import { recordOutgoingDocument } from "@peppol/data/record-outgoing-document";
import { validateXmlDocument } from "@peppol/data/validation/client";
import { ulid } from "ulid";
import { prepareIncomingDocument } from "../receiving/prepare-document";
import {
  normalizeProviderSentIdentifiers,
  providerSentDelivery,
} from "./document";
import type { ProviderSentPipelineInput } from "./types";

/**
 * Records a document an access point sent on a company's behalf without our sending
 * pipeline producing it (for example a message level response the provider answers
 * with automatically). The document is stored, billed and published exactly like one
 * we sent ourselves, so a team sees everything that left under its Peppol id.
 *
 * Returns null when the sender is not one of our companies on this network, which is
 * not an error: the provider reports every transaction on the access point.
 */
export async function providerSentPipeline(
  options: ProviderSentPipelineInput,
): Promise<{ id: string } | null> {
  const { senderId, receiverId, docTypeId, processId } =
    normalizeProviderSentIdentifiers(options);

  const company = await findCompanyByPeppolId({
    peppolId: senderId,
    useTestNetwork: options.useTestNetwork,
    // A company can send without being registered to receive.
    requireSmpRecipient: false,
  });
  if (!company) {
    return null;
  }

  const prepared = await prepareIncomingDocument({
    docTypeId,
    processId,
    body: options.body,
    contentType: options.contentType,
    company,
    senderId,
  });
  const validation = await validateXmlDocument(prepared.xmlDocument);

  return await recordOutgoingDocument({
    c: options.c ?? null,
    id: `doc_${ulid()}`,
    teamId: company.teamId,
    company,
    // Only playground teams are on the test network, and their documents are not
    // billed there either when they send through our own API.
    isPlayground: options.useTestNetwork ?? false,
    inputFormat: "access_point",
    document: {
      senderId,
      receiverId,
      docTypeId,
      processId,
      countryC1: options.countryC1 || company.country,
      type: prepared.type as any,
      parsed: prepared.parsedDocument,
      xml: prepared.xmlDocument,
      validation,
    },
    delivery: providerSentDelivery({
      apTransactionId: options.apTransactionId,
      sbdhInstanceIdentifier: options.sbdhInstanceIdentifier,
    }),
    originalPayload: prepared.originalPayload,
  });
}

export {
  normalizeProviderSentIdentifiers,
  providerSentDelivery,
} from "./document";
export type { ProviderSentPipelineInput } from "./types";
