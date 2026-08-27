import { audit } from "@core/lib/audit";
import {
  getAccessPointProvider,
  type SendAs4Response,
} from "@peppol/data/access-point-providers";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { sendDocumentEmail } from "@peppol/data/email/send-email";
import { simulateSendAs4 } from "@peppol/data/playground/simulate-ap";
import { recordOutgoingDocument } from "@peppol/data/record-outgoing-document";
import { getRecipientCapabilities } from "@peppol/data/recipient-capabilities";
import { normalizePeppolAddress } from "@peppol/utils/parsing/peppol-address";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { recordSendDocumentDelivery } from "@peppol/utils/metrics";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { ulid } from "ulid";
import { SendingFailure } from "./errors";
import { assertFranceRegulatedSendingSupported } from "./france-regulated-guard";
import { prepareJsonDocument } from "./prepare-json-document";
import { prepareXmlDocument } from "./prepare-xml-document";
import type { SendingContext } from "./types";
import { validateDocument } from "./validate-document";

export async function sendingPipeline(c: SendingContext) {
  let inputFormat = "unknown";

  try {
    const input = c.req.valid("json");
    inputFormat = input.documentType === "xml" ? "xml" : "json_api";
    const company = c.var.company;
    const team = c.var.team;
    const isPlayground = team.isPlayground ?? false;
    const useTestNetwork = team.useTestNetwork ?? false;
    const documentId = `doc_${ulid()}`;
    const recipientAddress = normalizePeppolAddress(input.recipient);

    const documentType = getDocumentType(input.documentType);
    if (recipientAddress === null && documentType?.class !== "billing") {
      throw new SendingFailure(
        "Only billing document types (invoice, creditNote, selfBillingInvoice, selfBillingCreditNote) are supported when recipient is null.",
        400,
      );
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

    const senderIdentifier = await getSendingCompanyIdentifier(company.id);
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
            recipientAddress,
            isPlayground,
            useTestNetwork,
            teamId: team.id,
          })
        : null;

    const prepared =
      input.documentType === "xml"
        ? prepareXmlDocument(input)
        : await prepareJsonDocument({
            input,
            company,
            senderAddress,
            recipientAddress,
            documentId,
            isPlayground,
            recipientCapabilities,
          });

    // Recorded as soon as it is known, before the guard below can refuse the send: how a
    // document was going to be routed is what a replay needs in order to send the same
    // one, and it is the one part of that decision a recipient lookup made rather than
    // the request.
    c.set("sendDocumentRecordingRouting", {
      docTypeId: prepared.docTypeId,
      processId: prepared.processId,
    });

    // We want to ensure French regulated flows are only supported for companies in France and over the AT access point.
    assertFranceRegulatedSendingSupported({
      docTypeId: prepared.docTypeId,
      processId: prepared.processId,
      company,
      isPlayground,
    });

    const xmlDocument = recipientAddress === null ? null : prepared.xml;
    c.set("sendDocumentRecordingXml", xmlDocument);

    const validation = xmlDocument
      ? await validateDocument(xmlDocument)
      : undefined;

    let sentPeppol = false;
    let as4Response: SendAs4Response | null = null;
    let peppolFailure = "";
    if (recipientAddress !== null) {
      if (prepared.peppolRoutingFailure) {
        // The recipient receives nothing this document can be written as, so the
        // transmission is skipped rather than handed to an access point that can only
        // return the same answer. Email delivery, if configured, still applies.
        peppolFailure = prepared.peppolRoutingFailure;
      } else if (isPlayground && !useTestNetwork) {
        try {
          await simulateSendAs4({
            senderId: senderAddress,
            receiverId: recipientAddress,
            docTypeId: prepared.docTypeId,
            processId: prepared.processId,
            countryC1: company.country,
            body: prepared.body,
            contentType: prepared.contentType,
            playgroundTeamId: team.id,
          });
          sentPeppol = true;
        } catch (error) {
          console.error("Failed to simulate send as4:", error);
          peppolFailure =
            error instanceof Error
              ? error.message
              : "No additional context available, please contact support@recommand.eu if you could use our help.";
        }
      } else {
        as4Response = await getAccessPointProvider(
          company.accessPointProvider,
        ).sendAs4({
          senderId: senderAddress,
          receiverId: recipientAddress,
          docTypeId: prepared.docTypeId,
          processId: prepared.processId,
          countryC1: company.country,
          body: prepared.body,
          contentType: prepared.contentType,
          useTestNetwork,
        });
        sentPeppol = as4Response.ok;
        if (!sentPeppol) {
          peppolFailure =
            as4Response.sendingException?.message ??
            "No additional context available, please contact support@recommand.eu if you could use our help.";
        }
      }

      if (!sentPeppol && !input.email) {
        throw new SendingFailure(
          `Failed to send document over Peppol network. ${peppolFailure}`,
          422,
        );
      }
    }

    const emailRecipients: string[] = [];
    let emailFailure = "";
    if (input.email && (input.email.when === "always" || !sentPeppol)) {
      for (const recipient of input.email.to) {
        try {
          await sendDocumentEmail({
            to: recipient,
            subject: input.email.subject,
            htmlBody: input.email.htmlBody,
            xmlDocument,
            type: prepared.type as any,
            parsedDocument: prepared.parsed,
            isPlayground,
          });
          emailRecipients.push(recipient);
        } catch (error) {
          console.error("Failed to send email:", error);
          emailFailure =
            error instanceof Error
              ? error.message
              : "No additional context available, please contact support@recommand.eu if you could use our help.";
        }
      }
    }

    if (!sentPeppol && emailRecipients.length === 0) {
      throw new SendingFailure(
        `Failed to send document over Peppol network and email. ${peppolFailure} ${emailFailure}`,
        422,
      );
    }

    const transmittedDocument = await recordOutgoingDocument({
      c,
      id: documentId,
      teamId: team.id,
      company,
      isPlayground,
      inputFormat,
      document: {
        senderId: senderAddress,
        receiverId: recipientAddress,
        docTypeId: prepared.docTypeId,
        processId: prepared.processId,
        countryC1: company.country,
        type: prepared.type as any,
        parsed: prepared.parsed,
        xml: xmlDocument,
        validation,
      },
      delivery: {
        kind: "peppol",
        sentPeppol,
        emailRecipients,
        as4Response,
      },
      originalPayload: prepared.originalPayload,
    });

    recordSendDocumentDelivery({
      documentType: prepared.type,
      isPlayground,
      useTestNetwork,
      sentOverPeppol: sentPeppol,
      emailRecipientCount: emailRecipients.length,
    });

    return c.json(
      actionSuccess({
        teamId: team.id,
        companyId: company.id,
        id: transmittedDocument.id,
        peppolMessageId: as4Response?.peppolMessageId ?? null,
        envelopeId: as4Response?.sbdhInstanceIdentifier ?? null,
        sentOverPeppol: sentPeppol,
        sentOverEmail: emailRecipients.length > 0,
        emailRecipients,
        ...(peppolFailure
          ? { additionalPeppolFailureContext: peppolFailure }
          : {}),
        ...(emailFailure
          ? { additionalEmailFailureContext: emailFailure }
          : {}),
      }),
    );
  } catch (error) {
    if (error instanceof SendingFailure) {
      const failure =
        typeof error.payload === "string"
          ? actionFailure(error.payload)
          : actionFailure(error.payload);
      return c.json(failure, error.status);
    }

    console.error(error);
    await audit(c, {
      action: "create",
      subsystem: "peppol.documents",
      outcome: "failed",
      objectType: "peppol.document",
      reasonCode: "send_document_failed",
      metadata: {
        inputFormat,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    sendSystemAlert(
      "Document Sending Failed",
      `Failed to send document over Peppol network. Error: \`\`\`\n${error}\n\`\`\``,
      "error",
    );
    return c.json(
      actionFailure(
        error instanceof Error ? error.message : "Failed to send document",
      ),
      400,
    );
  }
}

export default sendingPipeline;
