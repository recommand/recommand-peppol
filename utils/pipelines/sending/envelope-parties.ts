import { XMLParser } from "fast-xml-parser";
import { getTextContent } from "@peppol/utils/parsing/xml-helpers";
import {
  sameParticipant,
  splitPeppolAddress,
  type PeppolParticipant,
} from "@peppol/utils/parsing/peppol-address";
import {
  identifierFailsSchemeValidation,
  identifierNamesAnotherCompany,
} from "@peppol/utils/identifier-validation";
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
 * Undefined for every other document, and for one that cannot be read: no rule says
 * which of its parties the envelope has to name, so nothing is held against it.
 */
export function readEnvelopeParties(xml: string): EnvelopeParties | undefined {
  try {
    return readParties(parser.parse(xml));
  } catch {
    return undefined;
  }
}

function readParties(parsed: Record<string, any>): EnvelopeParties | undefined {
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
 * Refuses a raw XML document whose sender or receiver is certainly wrong, before
 * anything is sent.
 *
 * The enveloping rules want the envelope and the document to name the same
 * participants. A difference is only refused where it cannot be right, because a
 * document that differs from the envelope may still arrive: participant identifiers are
 * case insensitive (Peppol Policy for use of Identifiers, POLICY 2), and companies are
 * reachable under more than one identifier. So:
 * - the receiver is refused when it is not the recipient and its value is not a valid
 *   identifier under its scheme, such as an email address under 0002;
 * - the sender is refused, when `checkSender` is set, when it is not the address the
 *   company sends from and is a valid national number of another company of the
 *   company's country (see identifierNamesAnotherCompany).
 * Any other difference, including case, is left as it is.
 *
 * The check fails open: an unexpected error in it is logged and the send goes on as if
 * it had not run.
 */
export function assertEnvelopePartiesPlausible(
  parties: EnvelopeParties | undefined,
  transmission: {
    senderAddress: string;
    recipientAddress: string;
    company: { enterpriseNumber: string | null; vatNumber: string | null; country: string };
    checkSender: boolean;
  }
): void {
  let errors: string[];
  try {
    errors = envelopePartyErrors(parties, transmission);
  } catch (error) {
    console.error("Failed to check the parties of an XML document against its envelope:", error);
    return;
  }
  if (errors.length === 0) return;

  throw new SendingFailure(
    {
      root: [
        "The sender or receiver in the document cannot be the Peppol participant it is sent between. Peppol BIS Billing requires the document's party endpoints to match the envelope (rules BR-SBDH-1 to BR-SBDH-4), and the receiving access point may reject the document otherwise.",
        ...errors,
      ],
    },
    400
  );
}

function envelopePartyErrors(
  parties: EnvelopeParties | undefined,
  transmission: Parameters<typeof assertEnvelopePartiesPlausible>[1]
): string[] {
  if (!parties) return [];
  const errors: string[] = [];

  const sender = splitPeppolAddress(transmission.senderAddress);
  if (
    transmission.checkSender &&
    parties.sender &&
    sender &&
    !sameParticipant(parties.sender.participant, sender) &&
    identifierNamesAnotherCompany({
      scheme: parties.sender.participant.scheme,
      identifier: parties.sender.participant.identifier,
      company: transmission.company,
    })
  ) {
    errors.push(
      `The document names ${spell(parties.sender.participant)} as its sender in ${parties.sender.element}, which is another company's number. Write one of this company's Peppol identifiers there, such as ${transmission.senderAddress} (schemeID "${sender.scheme}", value "${sender.identifier}").`
    );
  }

  const receiver = splitPeppolAddress(transmission.recipientAddress);
  if (
    parties.receiver &&
    receiver &&
    !sameParticipant(parties.receiver.participant, receiver) &&
    identifierFailsSchemeValidation(parties.receiver.participant.scheme, parties.receiver.participant.identifier)
  ) {
    errors.push(
      `The document names ${spell(parties.receiver.participant)} as its receiver in ${parties.receiver.element}, which is not a valid identifier under scheme ${parties.receiver.participant.scheme}. Write the recipient's Peppol address there, such as ${transmission.recipientAddress} (schemeID "${receiver.scheme}", value "${receiver.identifier}").`
    );
  }

  return errors;
}
