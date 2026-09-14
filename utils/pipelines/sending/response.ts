import type { SendAs4Response } from "@peppol/data/access-point-providers";
import {
  summarizeDeliveryStatus,
  toDeliverySummary,
  type DocumentDelivery,
} from "@peppol/data/deliveries/model";

/**
 * The body of a successful send. `sentOverPeppol`, `sentOverEmail` and
 * `emailRecipients` describe what this request did: they are what the send knew as
 * it handed the document over. `deliveries` and `deliveryStatus` are read back after
 * recording and are where the document stands, which can already be further along:
 * an access point's report that overtook the send may have failed the transmission
 * and sent the email fallback, and those email deliveries then appear here while
 * the request's own fields still say no email was sent by it.
 */
export function sendDocumentResponseBody(input: {
  teamId: string;
  companyId: string;
  documentId: string;
  as4Response: SendAs4Response | null;
  sentPeppol: boolean;
  emailRecipients: string[];
  deliveries: DocumentDelivery[];
  peppolFailure: string;
  emailFailure: string;
}) {
  const references = {
    peppolMessageId: input.as4Response?.peppolMessageId ?? null,
    peppolConversationId: input.as4Response?.peppolConversationId ?? null,
    envelopeId: input.as4Response?.sbdhInstanceIdentifier ?? null,
  };
  const deliveries = input.deliveries.map((delivery) => toDeliverySummary(delivery, references));
  return {
    teamId: input.teamId,
    companyId: input.companyId,
    id: input.documentId,
    peppolMessageId: references.peppolMessageId,
    envelopeId: references.envelopeId,
    sentOverPeppol: input.sentPeppol,
    sentOverEmail: input.emailRecipients.length > 0,
    emailRecipients: input.emailRecipients,
    deliveryStatus: summarizeDeliveryStatus(deliveries.map((delivery) => delivery.status)),
    deliveries,
    ...(input.peppolFailure ? { additionalPeppolFailureContext: input.peppolFailure } : {}),
    ...(input.emailFailure ? { additionalEmailFailureContext: input.emailFailure } : {}),
  };
}
