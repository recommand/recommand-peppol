import { formatISO } from "date-fns";
import { renderDespatchAdvice } from "@peppol/utils/operational-document-renderer";
import {
  despatchAdviceSchema,
  sendDespatchAdviceSchema,
} from "@peppol/utils/parsing/despatch-advice/schemas";
import { getDocumentTypeTitle } from "@peppol/lib/client/document-type-labels";
import type { DocumentType } from "./types";
import { normalize } from "./normalize";
import { companyIdentifiers, identifiedParty } from "./party-identifiers";
import { withGeneratedAttachment } from "./attachments";
import { cleanEnterpriseNumber } from "@peppol/utils/util";
import { negativeQuantityIssues } from "./intake-helpers";

// How AI intake reads a despatch advice, a delivery note, from a PDF: quantities and
// references to the order, no amounts, and parties with party identifiers only.
const DESPATCH_ADVICE_INSTRUCTIONS = [
  "The despatch party sends the goods and issues the delivery note: usually the seller or its warehouse. The consignee is the party that the goods are delivered to, at the delivery address. Put the buyer and the seller in buyer and seller only when they are other parties than the consignee and the despatch party.",
  "A delivery note states no prices or amounts. Do not copy prices, VAT or totals that it prints.",
  "A party of a delivery note has no VAT number or enterprise number field. Put one registration number of the party in partyIdentifiers, with its ISO/IEC 6523 scheme when you know it: 0208 for a Belgian enterprise number, also when the document prints it as a Belgian VAT number (write the 10 digits without BE), 0106 for a Dutch KvK number and 0088 for a GLN. Leave the scheme out of another number, such as a customer number.",
  "Put the order number of the buyer in orderReference. When the lines belong to different orders, put the order number of each line in the orderReference of the line. When the delivery note prints no order number, add a missing_value finding for /orderReference.",
  "Put the number of the order line in orderLineReference only when the delivery note prints it. Never use the line number of the delivery note for it.",
  "quantity is the quantity that this delivery note delivers, not the ordered quantity. Put a quantity that is ordered but delivered later, such as a back order, \"to follow\", \"nog te leveren\" or \"reste à livrer\", in outstandingQuantity, and the printed reason in outstandingReason.",
  "Each line needs an article number: the article number of the despatch party in sellersId, or a GTIN or EAN in standardId with scheme 0160. An article number that the delivery note prints without saying whose it is, is the article number of the despatch party. Put the article number of the buyer in buyersId.",
  "Put the serial numbers, lot or batch numbers, and the expiry and best-before dates of the delivered units in the itemInstances of the line.",
  "Put the transport in shipment: the carrier, the tracking number in trackingId, the waybill or consignment number in consignmentId, the gross weight and volume with their unit codes, the number of pallets or packages in handlingUnitCount, the date the goods left in actualDespatchDate, and the expected delivery date in estimatedDeliveryPeriod.",
];

type IdentifiedParty = { partyIdentifiers?: { identifier?: unknown; scheme?: unknown }[] | null } | null;

/**
 * A registration number under a scheme is written without dots or spaces, as the
 * formats require; a number without a scheme, such as a customer number, stays as printed.
 */
function cleanPartyIdentifiers(party: IdentifiedParty): IdentifiedParty {
  if (!Array.isArray(party?.partyIdentifiers)) {
    return party;
  }
  return {
    ...party,
    partyIdentifiers: party.partyIdentifiers.map((entry) =>
      typeof entry?.identifier === "string" && typeof entry.scheme === "string" && entry.scheme.trim()
        ? { ...entry, identifier: cleanEnterpriseNumber(entry.identifier) }
        : entry,
    ),
  };
}

function despatchAdviceNormalize(document: unknown): unknown {
  const despatchAdvice = document as Record<string, unknown> | null;
  if (!despatchAdvice || typeof despatchAdvice !== "object") {
    return despatchAdvice;
  }
  return {
    ...despatchAdvice,
    despatchParty: cleanPartyIdentifiers(despatchAdvice.despatchParty as IdentifiedParty),
    consignee: cleanPartyIdentifiers(despatchAdvice.consignee as IdentifiedParty),
  };
}

export const despatchAdviceDocumentType: DocumentType<
  typeof sendDespatchAdviceSchema,
  typeof despatchAdviceSchema
> = {
  key: "despatchAdvice",
  translatableTitle: getDocumentTypeTitle("despatchAdvice"),
  class: "operational",
  aiIntake: {
    classification:
      "The party that sends goods lists what it delivers: a delivery note, packing slip or despatch advice, \"leveringsbon\", \"pakbon\", \"bon de livraison\" or \"Lieferschein\". It states quantities, usually without prices, and does not ask for payment.",
    instructions: DESPATCH_ADVICE_INSTRUCTIONS,
    normalize: despatchAdviceNormalize,
    issues: (document) => negativeQuantityIssues(document, ["quantity", "outstandingQuantity"]),
  },
  sendSchema: sendDespatchAdviceSchema,
  documentSchema: despatchAdviceSchema,

  preprocessFromSendAPI: (data, { company }) => {
    const despatchAdvice = sendDespatchAdviceSchema.parse(data.document);
    return {
      ...despatchAdvice,
      issueDate:
        despatchAdvice.issueDate ?? formatISO(new Date(), { representation: "date" }),
      // The despatching party sends the advice, so it is the party defaulted from the company.
      despatchParty: despatchAdvice.despatchParty ?? {
        partyIdentifiers: companyIdentifiers(company),
        name: company.name,
        street: company.address,
        city: company.city,
        postalZone: company.postalCode,
        country: company.country,
        email: company.email || null,
        phone: company.phone || null,
      },
    };
  },

  render: (document, options, context) =>
    renderDespatchAdvice(document, options, {
      documentId: context.documentId,
      type: "despatchAdvice",
      documentTypeTitle: despatchAdviceDocumentType.translatableTitle,
    }),

  generateFilename: (document) => `despatch-advice-${document.despatchAdviceNumber}`,

  pdfGeneration: {
    attachGeneratedPdf: (document, attachment) => ({
      ...document,
      attachments: withGeneratedAttachment(document.attachments, attachment),
    }),
  },

  email: {
    isEmailDeliverySupported: true,
    areEmailNotificationsSupported: true,
    extractDocumentDetails: (document) => {
      const { senderName, receiverName } =
        despatchAdviceDocumentType.extractCounterparties(document);
      return {
        documentNumber: despatchAdviceDocumentType.extractDocumentNumber(document) ?? undefined,
        amount: undefined,
        currency: undefined,
        senderName: senderName ?? undefined,
        senderEmail: normalize(document.despatchParty?.email) ?? undefined,
        receiverName: receiverName ?? undefined,
        receiverRole: "consignee",
        receiverAddressable: identifiedParty(document.consignee.partyIdentifiers),
      };
    },
  },

  extractCounterparties: (document) => ({
    senderName: normalize(document.despatchParty?.name),
    receiverName: normalize(document.consignee?.name),
  }),

  extractSearchableText: (document) => {
    const { senderName, receiverName } =
      despatchAdviceDocumentType.extractCounterparties(document);
    return [senderName, receiverName, document.despatchAdviceNumber, document.orderReference]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ");
  },

  extractDocumentNumber: (document) => normalize(document.despatchAdviceNumber),
};

export default despatchAdviceDocumentType;
