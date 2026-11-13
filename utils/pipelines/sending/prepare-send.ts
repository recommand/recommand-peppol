import type { Company } from "@peppol/data/companies";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { getRecipientCapabilities } from "@peppol/data/recipient-capabilities";
import type { SendDocumentRecordingRouting } from "@peppol/data/send-document-recording";
import type { ExtendedTeam } from "@peppol/data/teams";
import { normalizePeppolAddress } from "@peppol/utils/parsing/peppol-address";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { ulid } from "ulid";
import {
  assertEnvelopePartiesPlausible,
  readEnvelopeParties,
} from "./envelope-parties";
import { SendingFailure } from "./errors";
import {
  assertFranceRegulatedSendingSupported,
  assertNotFranceRegulatedByEmailOnly,
} from "./france-regulated-guard";
import { prepareJsonDocument } from "./prepare-json-document";
import { prepareXmlDocument } from "./prepare-xml-document";
import type { SendingInput } from "./types";
import { validateDocument } from "./validate-document";

/**
 * Everything a send decides before it tries a channel: the sender, the recipient and
 * how to reach them, the document as it will go out, and its validation. Throws a
 * `SendingFailure` for a request that can't be sent, so a caller can check a document
 * the way a send would, without sending it. `record` hears the routing and the document
 * as soon as they're known, for the send recording.
 */
export const prepareSend = async ({
  company,
  input,
  record,
  team,
}: {
  company: Company;
  input: SendingInput;
  record?: {
    routing: (routing: SendDocumentRecordingRouting) => void;
    xml: (xml: string | null) => void;
  };
  team: ExtendedTeam;
}) => {
  const isPlayground = team.isPlayground ?? false;
  const useTestNetwork = team.useTestNetwork ?? false;
  const documentId = `doc_${ulid()}`;
  const recipientAddress = normalizePeppolAddress(input.recipient);

  // Raw XML only says what it is once it is read, so its type is checked below.
  if (recipientAddress === null && input.documentType !== "xml") {
    assertEmailOnlyDocumentType(input.documentType, BILLING_ONLY_WITHOUT_RECIPIENT);
  }

  if (recipientAddress === null && !input.email?.to.length) {
    throw new SendingFailure(
      "Either recipient (for Peppol) or email.to (for email delivery) must be provided.",
      400,
    );
  }

  if (
    input.documentType === "xml" &&
    input.pdfGeneration?.enabled
  ) {
    throw new SendingFailure(
      "PDF generation is not supported for raw XML documents.",
      400,
    );
  }

  // A raw XML invoice or credit note names its own sender and receiver, which a
  // receiving access point may hold against the envelope. The sender it names decides
  // which of the company's identifiers it goes out under, and both are checked below.
  // Not through the French access point, which addresses the envelope under rules of
  // its own.
  const envelopeParties =
    input.documentType === "xml" &&
    recipientAddress !== null &&
    company.accessPointProvider !== "at-shared-ap-fr"
      ? readEnvelopeParties(input.document)
      : undefined;

  const senderIdentifier = await getSendingCompanyIdentifier(
    company,
    recipientAddress,
    envelopeParties?.sender?.participant,
  );
  const senderAddress = `${senderIdentifier.scheme}:${senderIdentifier.identifier}`;

  // Raw XML already is one specific format, and states the process it belongs to, so
  // there is nothing to route: only a JSON document, which we still have to write,
  // can be adapted to what the recipient is able to receive. Looking the recipient up
  // costs a request, so it only happens when something is left to decide.
  const recipientCapabilities =
    recipientAddress !== null &&
    input.documentType !== "xml" &&
    (!input.doctypeId || !input.processId)
      ? await getRecipientCapabilities({
          isPlayground,
          recipientAddress,
          teamId: team.id,
          useTestNetwork,
        })
      : null;

  // Without a Peppol recipient a document is emailed as a PDF, unless the caller names
  // the format it is to be written in: it is then written, validated and attached as
  // it would be for a Peppol recipient, so a buyer who is not on Peppol still receives
  // a structured document. Raw XML already is one, and is emailed as it was given.
  const isStructuredEmail =
    recipientAddress === null &&
    (input.documentType === "xml" || !!input.doctypeId);
  if (isStructuredEmail) {
    assertNotFranceRegulatedByEmailOnly({
      docTypeId: input.doctypeId,
      processId: input.processId,
    });
  }

  const prepared =
    input.documentType === "xml"
      ? prepareXmlDocument(input)
      : await prepareJsonDocument({
          company,
          documentId,
          input,
          isPlayground,
          recipientAddress,
          recipientCapabilities,
          senderAddress,
          structuredEmailTo: isStructuredEmail ? input.email?.to : undefined,
        });

  // Recorded as soon as it is known, before the guard below can refuse the send: how a
  // document was going to be routed is what a replay needs in order to send the same
  // one, and it is the one part of that decision a recipient lookup made rather than
  // the request.
  record?.routing({
    docTypeId: prepared.docTypeId,
    processId: prepared.processId,
  });

  // Checked first: a French regulated document without a Peppol recipient is refused
  // for that reason, whatever the company is set up for.
  if (isStructuredEmail) {
    assertNotFranceRegulatedByEmailOnly({
      docTypeId: prepared.docTypeId,
      processId: prepared.processId,
    });
  }

  // We want to ensure French regulated flows are only supported for companies in France and over the AT access point.
  assertFranceRegulatedSendingSupported({
    company,
    docTypeId: prepared.docTypeId,
    isPlayground,
    processId: prepared.processId,
  });

  const xmlDocument =
    recipientAddress === null && !isStructuredEmail ? null : prepared.xml;
  record?.xml(xmlDocument);

  // The sender is not checked in the playground, whose transmissions are simulated
  // and whose companies send example documents written for someone else.
  if (recipientAddress !== null) {
    assertEnvelopePartiesPlausible(envelopeParties, {
      checkSender: !(isPlayground && !useTestNetwork),
      company,
      recipientAddress,
      senderAddress,
    });
  }

  const validation = xmlDocument
    ? await validateDocument(xmlDocument, prepared.docTypeId)
    : undefined;

  // After validation, so XML in a known format that could not be read is refused with
  // the rules it breaks rather than only for its unknown type.
  if (recipientAddress === null && input.documentType === "xml") {
    assertEmailOnlyDocumentType(prepared.type, RAW_XML_BILLING_ONLY_WITHOUT_RECIPIENT);
  }

  return {
    documentId,
    isPlayground,
    prepared,
    recipientAddress,
    recipientCapabilities,
    senderAddress,
    useTestNetwork,
    validation,
    xmlDocument,
  };
};

const BILLING_ONLY_WITHOUT_RECIPIENT =
  "Only billing document types (invoice, creditNote, selfBillingInvoice, selfBillingCreditNote) are supported when recipient is null.";
const RAW_XML_BILLING_ONLY_WITHOUT_RECIPIENT =
  "A raw XML document can only be sent without a Peppol recipient when it is an invoice, credit note, self-billing invoice or self-billing credit note in a supported format.";

/**
 * Only document types that say they can be delivered by email may go without a Peppol
 * recipient: the billing documents. A message level response or a report goes to a
 * Peppol participant or nowhere. A raw XML document that could not be read as one of
 * the supported formats has no known type, and is refused as well.
 */
const assertEmailOnlyDocumentType = (type: string, message: string): void => {
  if (!getDocumentType(type)?.email?.isEmailDeliverySupported) {
    throw new SendingFailure(message, 400);
  }
};
