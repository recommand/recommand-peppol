import { XMLParser } from "fast-xml-parser";
import { getTextContent } from "@peppol/utils/parsing/xml-helpers";
import {
  sameParticipant,
  splitPeppolAddress,
  type PeppolParticipant,
} from "@peppol/utils/parsing/peppol-address";
import { SendingFailure } from "./errors";

/** An endpoint a document names, spelled as the document spells it, and where. */
export type EnvelopePartyEndpoint = {
  participant: PeppolParticipant;
  element: string;
};

/**
 * The parties a document says the envelope has to carry it between. A side is null
 * when the document does not state it in full.
 */
export type EnvelopeParties = {
  sender: EnvelopePartyEndpoint | null;
  receiver: EnvelopePartyEndpoint | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Identifiers are text: read as numbers they would lose their leading zeros.
  parseTagValue: false,
});

// The documents the Peppol BIS Billing 3.0 enveloping rules (BR-SBDH-1 to BR-SBDH-4)
// apply to, recognised exactly as those rules recognise them: by the customization and
// profile the document declares.
// https://docs.peppol.eu/poacc/billing/3.0/files/PeppolBIS-Envelope-Rules.sch
const BILLING_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const BILLING_PROFILE_IDS = [
  "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  "urn:peppol:bis:billing_with_response",
];
const SELF_BILLING_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0";
const SELF_BILLING_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0";

/** The value as XPath `normalize-space` reads it, which is how the rules read it. */
function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readEndpoint(party: any, element: string): EnvelopePartyEndpoint | null {
  const node = party?.Party?.EndpointID;
  const identifier = normalizeSpace(getTextContent(node));
  const scheme = typeof node === "object" ? String(node?.["@_schemeID"] ?? "").trim() : "";
  // An endpoint without a value or a scheme is left to validation, which requires both.
  if (!identifier || !scheme) return null;
  return { participant: { scheme, identifier }, element };
}

/**
 * The sender and receiver a raw XML document names, for the documents the Peppol BIS
 * Billing enveloping rules apply to: a UBL Invoice or CreditNote under the BIS Billing
 * customization travels from the supplier to the customer (BR-SBDH-1 and 2), and one
 * under the BIS Self-Billing customization from the customer to the supplier
 * (BR-SBDH-3 and 4).
 *
 * Undefined for every other document, and for one that cannot be parsed: no rule says
 * which of its parties the envelope has to name, so nothing is held against it.
 */
export function readEnvelopeParties(xml: string): EnvelopeParties | undefined {
  let parsed: Record<string, any>;
  try {
    parsed = parser.parse(xml);
  } catch {
    return undefined;
  }
  const root = parsed?.Invoice ?? parsed?.CreditNote;
  if (!root || typeof root !== "object") return undefined;

  const customizationId = normalizeSpace(getTextContent(root.CustomizationID));
  const profileId = normalizeSpace(getTextContent(root.ProfileID));
  const isSelfBilling =
    customizationId === SELF_BILLING_CUSTOMIZATION_ID && profileId === SELF_BILLING_PROFILE_ID;
  const isBilling =
    customizationId === BILLING_CUSTOMIZATION_ID && BILLING_PROFILE_IDS.includes(profileId);
  if (!isBilling && !isSelfBilling) return undefined;

  const supplier = readEndpoint(
    root.AccountingSupplierParty,
    "AccountingSupplierParty/Party/EndpointID"
  );
  const customer = readEndpoint(
    root.AccountingCustomerParty,
    "AccountingCustomerParty/Party/EndpointID"
  );
  return isSelfBilling
    ? { sender: customer, receiver: supplier }
    : { sender: supplier, receiver: customer };
}

function spell({ scheme, identifier }: PeppolParticipant): string {
  return `${scheme}:${identifier}`;
}

/**
 * The sender and receiver to put on the envelope of a raw XML document, given the
 * parties the document names and the participants the transmission goes between.
 *
 * The enveloping rules compare the envelope with the document character for
 * character, while participant identifiers are case insensitive on the network. A side
 * the document names as the same participant, written in other case or spacing, is
 * therefore not refused: the envelope takes the document's spelling, so the comparison
 * holds literally. A side naming another participant is refused before anything is
 * sent, since the receiving access point would reject the document after it left:
 * - a receiver other than the recipient of the request;
 * - a sender that is not the address the company sends from. The caller has already
 *   chosen, as that address, the company identifier the document names where it is
 *   one (see chooseSendingCompanyIdentifier), so a sender left over here is not the
 *   company's.
 *
 * `checkReceiver` is false when the recipient's scheme was not given but assumed, in
 * which case the receiver the document names is left as it is.
 */
export function matchEnvelopeToDocument(
  parties: EnvelopeParties | undefined,
  transmission: { senderAddress: string; recipientAddress: string; checkReceiver: boolean }
): { senderId: string; receiverId: string } {
  const envelope = {
    senderId: transmission.senderAddress,
    receiverId: transmission.recipientAddress,
  };
  if (!parties) return envelope;

  const errors: string[] = [];

  const sender = splitPeppolAddress(transmission.senderAddress);
  if (parties.sender && sender) {
    if (sameParticipant(parties.sender.participant, sender)) {
      envelope.senderId = spell(parties.sender.participant);
    } else {
      errors.push(
        `The document names ${spell(parties.sender.participant)} as its sender in ${parties.sender.element}, which is not a Peppol identifier of this company. Write one of the company's identifiers there, such as ${transmission.senderAddress} (schemeID "${sender.scheme}", value "${sender.identifier}").`
      );
    }
  }

  const receiver = splitPeppolAddress(transmission.recipientAddress);
  if (transmission.checkReceiver && parties.receiver && receiver) {
    if (sameParticipant(parties.receiver.participant, receiver)) {
      envelope.receiverId = spell(parties.receiver.participant);
    } else {
      errors.push(
        `The document names ${spell(parties.receiver.participant)} as its receiver in ${parties.receiver.element}, but the request sends it to ${transmission.recipientAddress}. Write the recipient's Peppol address there (schemeID "${receiver.scheme}", value "${receiver.identifier}"), or set \`recipient\` to the address the document names.`
      );
    }
  }

  if (errors.length > 0) {
    throw new SendingFailure(
      {
        root: [
          "The sender and receiver in the document do not match the Peppol sender and recipient it is sent between (Peppol BIS Billing rules BR-SBDH-1 to BR-SBDH-4). The receiving access point compares them and would reject the document.",
          ...errors,
        ],
      },
      400
    );
  }
  return envelope;
}
