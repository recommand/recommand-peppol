/**
 * Making a recorded send and its replay comparable.
 *
 * A recording was made by the production environment, for a production
 * company, at the moment it was captured. The replay runs against a playground
 * company, now. Anything the API derives from the *request* has to come out
 * identical or it is a regression; anything it derives from the *environment*
 * cannot, and is masked here instead.
 *
 * Every mask is listed explicitly and is as narrow as possible: masking hides
 * regressions, so the rules below are derived from the recorded request
 * wherever they can be. A field the request supplied is never masked.
 */

/**
 * Whether the Peppol network, rather than the API, decided how a send ended.
 *
 * Production sends fail for reasons that have nothing to do with our code: the
 * receiving access point was down, or the recipient was not registered on the
 * network at all. The playground answers with a simulator instead, which
 * accepts every address, so those recordings would replay as a success and
 * report a regression that is not one. The reverse happens too, for a
 * recipient the simulator is hardcoded to refuse.
 *
 * Three signals, all of them readable from the response alone:
 *
 * - a 422, which the send API only ever answers when delivery failed — every
 *   other rejection is a 400;
 * - `sentOverPeppol: false`, which is a delivery that failed and was saved by
 *   the email fallback, so the 200 is one too;
 * - `additionalPeppolFailureContext`, which is the access point's own account
 *   of what went wrong.
 */
export function networkDecidedOutcome(status: number, body: any): boolean {
  if (status === 422) return true;
  if (!body || typeof body !== "object") return false;
  return (
    body.sentOverPeppol === false || !!body.additionalPeppolFailureContext
  );
}

/** A field the request left for the API to fill in from the sending company. */
function omitted(document: any, field: string): boolean {
  return document[field] === undefined || document[field] === null;
}

/** Whether the document's seller was defaulted from the sending company. */
export function sellerFromSendingCompany(request: any): boolean {
  if (request?.documentType === "xml") return false;
  return omitted(request?.document ?? {}, "seller");
}

/**
 * The validation rules that turn on whether the *sender* has a VAT number.
 *
 * BT-31 is the seller's VAT identifier and BT-63 its tax representative's.
 * Around a dozen Schematron rules require one of them to be present or absent
 * depending on the VAT category of the lines — BR-O-02 forbids them on an
 * invoice that is not subject to VAT, BR-S-02 and its siblings require them
 * elsewhere.
 */
const SENDER_VAT_RULE = /BT-31|BT-63|Seller VAT identifier/;

/**
 * Whether a replay was refused only because of *who* is sending it.
 *
 * When a request omits `seller`, the API fills it in from the company doing the
 * sending — the recorded company in production, the playground company here.
 * If the two differ in whether they have a VAT number at all, the replayed
 * document carries a seller VAT identifier where the recorded one did not, or
 * the other way round, and the validator refuses it. Nothing about the API
 * changed; the sender did, and it is the one piece of the environment that
 * reaches the validator where masking cannot follow.
 *
 * Narrow on purpose, so it cannot swallow a real rejection:
 *
 * - only for a request that left the seller to be filled in — one that supplied
 *   its own is compared as strictly as any other;
 * - only when *every* rule that fired is about the seller's VAT identity, so a
 *   document with any other problem still fails;
 * - and the caller applies it only where the recording succeeded, which is what
 *   makes the sender the only candidate: production validated the same document
 *   against the same rules and passed.
 */
export function senderIdentityRejection(
  request: any,
  status: number,
  body: any,
): boolean {
  if (status !== 400) return false;
  if (!sellerFromSendingCompany(request)) return false;

  const errors = body?.errors;
  if (!errors || typeof errors !== "object") return false;

  // `root` carries the generic "Document validation failed" headline that
  // accompanies every validation failure, so it says nothing about which rules
  // fired.
  const messages = Object.entries(errors)
    .filter(([field]) => field !== "root")
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));

  return (
    messages.length > 0 &&
    messages.every(
      (message) => typeof message === "string" && SENDER_VAT_RULE.test(message),
    )
  );
}

/**
 * The refusal a send gets when the company sending it has no identifier at all.
 *
 * `getSendingCompanyIdentifier` (data/company-identifiers.ts) refuses a company
 * with no row in `company_identifiers` before anything about the document is
 * looked at. That is a property of the company the recording was made for, and
 * the replay sends as the playground company instead, which has one — so the
 * recorded refusal cannot be reproduced, and the recording says nothing about
 * what the API should have done with the document it carries, because
 * production never got that far either.
 *
 * The mirror image of `senderIdentityRejection`: there the recording succeeded
 * and the replay is refused over who is sending, here the recording was refused
 * over who is sending and the replay gets further.
 *
 * Matched on the message because it is thrown from exactly one place and names
 * the condition outright. Narrow in the same way as the rule above: only a 400,
 * and only when it is the *only* thing the API complained about, so a recording
 * refused for this and something else is compared as strictly as the rest.
 */
const NO_SENDING_IDENTIFIER =
  "No sending company identifier found. Ensure you have added a company identifier to your company.";

/**
 * Whether a refusal complained of one thing only, and that thing was `message`.
 *
 * Not filtered by field, unlike the VAT rule above: the messages these rules
 * match are reported under `root` itself, so `root` is the message rather than
 * a headline over it.
 */
function refusedOnlyBecause(body: any, message: string): boolean {
  const errors = body?.errors;
  if (!errors || typeof errors !== "object") return false;

  const messages = Object.values(errors).flatMap((value) =>
    Array.isArray(value) ? value : [value],
  );

  return messages.length > 0 && messages.every((entry) => entry === message);
}

export function missingSenderIdentifier(status: number, body: any): boolean {
  return status === 400 && refusedOnlyBecause(body, NO_SENDING_IDENTIFIER);
}

/**
 * The refusal a send gets when the company sending it is not set up for the
 * French regulated flows.
 *
 * Only a company registered in France sends over the French processes and
 * doctypes, and outside the playground only over the French access point. A
 * recording of one was made for a company that is; the playground company is
 * not, so the replay is refused before the document is built. Like the rule
 * above, that is the sending company's configuration rather than the API, and
 * it is matched the same way: thrown from one place, named outright, and only
 * when it is the only thing the API complained about.
 */
const NOT_SET_UP_FOR_FRANCE =
  "This company is not set up for French regulated document flows. Please contact support@recommand.eu.";

export function franceSetupRejection(status: number, body: any): boolean {
  return status === 400 && refusedOnlyBecause(body, NOT_SET_UP_FOR_FRANCE);
}

/** Response fields that identify the environment rather than the outcome. */
const VOLATILE_RESPONSE_FIELDS = [
  "id",
  "teamId",
  "companyId",
  // Assigned by the access point, absent in the playground simulator.
  "peppolMessageId",
  "envelopeId",
  // Verbatim text from the access point or the mail provider.
  "additionalPeppolFailureContext",
  "additionalEmailFailureContext",
] as const;

/**
 * What became of the mail. The replay is not asked to send any (see
 * `rewriteRequest`), so for a recording that asked for mail these describe a
 * delivery the suite removed rather than anything the API decided.
 */
const EMAIL_OUTCOME_FIELDS = [
  "sentOverEmail",
  "emailRecipients",
  "additionalEmailFailureContext",
] as const;

/**
 * Puts a response body in a canonical order so the comparison does not depend
 * on one.
 *
 * Object keys are already order independent in a deep equality check, but
 * arrays are not, and every array a send answers with is semantically a set:
 * the recipients a mail went to, the validation messages for a field, the
 * entries of `invalidInputDetails`. Their order follows the order of the
 * request or the order of the fields in a schema, so a refactor can shuffle
 * them without changing what the API did. Sorting both sides keeps that out of
 * the comparison.
 *
 * Keys are sorted as well, so the serialisation the array sort compares by is
 * itself stable. This is only ever applied to the response body: element order
 * in the XML is part of the document and is compared as it stands.
 */
function canonicalise(value: any): any {
  if (Array.isArray(value)) {
    return value
      .map(canonicalise)
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, nested]) => [key, canonicalise(nested)]),
    );
  }
  return value;
}

export function normaliseResponseBody(
  body: any,
  options: { emailWasNotSent: boolean },
): any {
  if (!body || typeof body !== "object") return body;

  const normalised: Record<string, unknown> = { ...body };
  for (const field of VOLATILE_RESPONSE_FIELDS) {
    if (field in normalised) normalised[field] = `[${field}]`;
  }
  // Dropped rather than masked: the replay answers with no such fields at all
  // where the recording has them, so a placeholder would compare a presence
  // that the suite itself decided.
  if (options.emailWasNotSent) {
    for (const field of EMAIL_OUTCOME_FIELDS) delete normalised[field];
  }
  return canonicalise(normalised);
}

/**
 * Takes the mail out of a recorded request.
 *
 * A recorded request carries the real addresses of real customers, and there is
 * nothing about the API to learn from mailing anyone: the delivery is
 * Postmark's, the message is assembled from the same document that is compared
 * in full anyway, and a run of this size would send tens of thousands of real
 * messages — which is billed, rate limited, and fails for reasons that have
 * nothing to do with this codebase. So the whole `email` block is removed
 * before the request goes out, and the fields describing what became of it are
 * removed from the comparison to match (`normaliseResponseBody`).
 *
 * What that gives up is stated plainly, because it is not nothing: the email
 * options are no longer exercised, so a change in how `email.when` is read, or
 * in which addresses a send reports back, is not caught here. The end-to-end
 * suite next door is where email delivery is asserted, on addresses written for
 * the purpose.
 *
 * Everything before delivery — the document, its validation, the Peppol leg —
 * is untouched by this and is compared exactly as strictly as before.
 */
export function rewriteRequest(request: any): any {
  if (!requestsEmail(request)) return request;
  const { email: _email, ...withoutEmail } = request;
  return withoutEmail;
}

/** Whether a recorded request asked for the document to be mailed. */
export function requestsEmail(request: any): boolean {
  return Array.isArray(request?.email?.to) && request.email.to.length > 0;
}

/**
 * A send whose only delivery is the mail: the API refuses it outright without
 * `email.to`, so removing the mail leaves no request to replay. Those
 * recordings are counted rather than replayed — see the README.
 */
export function isEmailOnlySend(request: any): boolean {
  return requestsEmail(request) && (request?.recipient ?? null) === null;
}

/**
 * Every `<localName>` element, whatever its namespace prefix, with everything
 * inside it. None of the names masked below nest inside themselves, so the
 * non-greedy match always ends at the right closing tag.
 */
function elementPattern(localName: string): RegExp {
  return new RegExp(
    `<((?:[\\w.-]+:)?${localName})(\\s[^>]*)?(/>|>[\\s\\S]*?</\\1>)`,
    "g",
  );
}

/** Replaces the content of an element, leaving its attributes as they are. */
function maskElement(xml: string, localName: string): string {
  return xml.replace(elementPattern(localName), (_match, tag, attributes) => {
    return `<${tag}${attributes ?? ""}>[masked ${localName}]</${tag}>`;
  });
}

/**
 * The elements that carry a party's Peppol address: `cbc:EndpointID` in UBL,
 * `ram:URIUniversalCommunication` — whose only child is the `ram:URIID` that
 * holds the address — in CII. The wrapper is masked rather than the `URIID`
 * itself because CII also uses that name for a contact's email address and for
 * an attachment's URL, neither of which the environment decides.
 */
const ADDRESS_ELEMENTS = ["EndpointID", "URIUniversalCommunication"];

/**
 * The party element that holds the *sending* company, per document type.
 *
 * The sender's address is the one the environment decides: it belongs to the
 * production company that recorded the send, and the replay is done by a
 * playground company registered under a different one — a `0208:` enterprise
 * number where the recording had a `9925:` VAT number, so the `schemeID`
 * attribute has to be masked along with the identifier.
 *
 * Which party that is depends on the document. A self-billing invoice is
 * written by the customer, so the sender is the customer there and the
 * supplier on an ordinary one. Both syntaxes are listed because the same
 * document is sent as UBL or as CII depending on the doctype id. A French CDAR
 * has no entry to mask: it writes an electronic address for the recipient
 * only.
 *
 * Naming the party rather than recognising the address by its value is what
 * makes a send to one's own address work: there the sender and the recipient
 * are the same address, and no rule phrased in terms of values can tell the
 * two apart.
 */
const SENDER_PARTY_ELEMENTS: Record<string, string[]> = {
  invoice: ["AccountingSupplierParty", "SellerTradeParty"],
  creditNote: ["AccountingSupplierParty", "SellerTradeParty"],
  selfBillingInvoice: ["AccountingCustomerParty", "BuyerTradeParty"],
  selfBillingCreditNote: ["AccountingCustomerParty", "BuyerTradeParty"],
  messageLevelResponse: ["SenderParty"],
  frenchInvoicingCdar: [],
};

/**
 * For a document type added since the list above was written: mask every party
 * that could hold a sender. The recipient's address stops being compared for
 * those, which is the safe direction to be wrong in, and adding the type above
 * gets it back.
 */
const EVERY_SENDER_PARTY = [
  ...new Set(Object.values(SENDER_PARTY_ELEMENTS).flat()),
];

function senderParties(documentType: unknown): string[] {
  if (typeof documentType !== "string") return EVERY_SENDER_PARTY;
  return SENDER_PARTY_ELEMENTS[documentType] ?? EVERY_SENDER_PARTY;
}

/** Masks the address elements inside the party that holds the sender. */
function maskSenderAddress(xml: string, parties: string[]): string {
  let masked = xml;
  for (const party of parties) {
    masked = masked.replace(elementPattern(party), (party_) => {
      let within = party_;
      for (const name of ADDRESS_ELEMENTS) {
        within = within.replace(
          elementPattern(name),
          (_match, tag) => `<${tag}>[masked ${name}]</${tag}>`,
        );
      }
      return within;
    });
  }
  return masked;
}

/**
 * The element that carries the document identifier the API generates when the
 * request omits one, per document type.
 *
 * A message level response and a French CDAR both get a UUID written for them
 * when their `id` is left out, and a UUID v7 carries the moment it was
 * generated, so it can only ever match the recording by accident. What is
 * masked is the *first* `ID` element inside the element named here — the
 * response's own id, the acknowledgement's own id — and nothing else: the
 * envelope id a message level response answers about and the invoice id a CDAR
 * reports on came from the request, and those stay compared.
 */
const GENERATED_ID_PARENTS: Record<string, string> = {
  messageLevelResponse: "ApplicationResponse",
  frenchInvoicingCdar: "ExchangedDocument",
};

/** Masks the first `ID` element inside `parent`, leaving any later one alone. */
function maskGeneratedId(xml: string, parent: string): string {
  return xml.replace(elementPattern(parent), (element) => {
    let masked = false;
    return element.replace(elementPattern("ID"), (match, tag, attributes) => {
      if (masked) return match;
      masked = true;
      return `<${tag}${attributes ?? ""}>[masked generated ID]</${tag}>`;
    });
  });
}

/**
 * The element names that hold something the environment decides, keyed by the
 * request field that would have decided it instead. UBL and CII names are both
 * listed because the same document type is sent in either syntax depending on
 * the format the doctype id selects.
 */
const ENVIRONMENT_ELEMENTS = {
  /** Generated PDFs are not byte reproducible: they carry a creation date. */
  always: ["EmbeddedDocumentBinaryObject", "BinaryObject"],
  /** Defaulted from the sending company when the request omits `seller`. */
  seller: ["AccountingSupplierParty", "SellerTradeParty"],
  /** Defaulted from the sending company when the request omits `buyer`. */
  buyer: ["AccountingCustomerParty", "BuyerTradeParty"],
  /** Defaulted to the day of the send when the request omits `issueDate`. */
  issueDate: ["IssueDate", "IssueDateTime"],
  /** Defaulted to a month after the issue date when `dueDate` is omitted. */
  dueDate: ["DueDate", "PaymentDueDate"],
} as const;

export type XmlMasks = {
  /** Element names whose content is replaced wherever they appear. */
  names: string[];
  /** The party elements whose Peppol address belongs to the sender. */
  senderParties: string[];
  /**
   * The element holding the document identifier the API generated, if it did.
   * See `GENERATED_ID_PARENTS`.
   */
  generatedIdParent?: string;
};

/**
 * Which masks apply to a recording, given what its request actually said.
 *
 * A raw XML send transmits the string it was given, so nothing about it is
 * environment derived and nothing is masked: it has to come back byte for
 * byte. Attachments a request supplied itself are the one deliberate
 * exception — they are masked along with generated PDFs, because the two are
 * not distinguishable in the XML.
 */
export function xmlMasks(request: any): XmlMasks {
  if (request?.documentType === "xml") {
    return { names: [], senderParties: [] };
  }

  const document = request?.document ?? {};
  const names: string[] = [...ENVIRONMENT_ELEMENTS.always];
  for (const field of ["seller", "buyer", "issueDate", "dueDate"] as const) {
    if (omitted(document, field)) {
      names.push(...ENVIRONMENT_ELEMENTS[field]);
    }
  }
  // Falsiness rather than `omitted`, because the API generates an id for an
  // empty string too — see the note in document-types/messageLevelResponse.ts.
  const generatedIdParent = !document.id
    ? GENERATED_ID_PARENTS[request?.documentType]
    : undefined;
  return {
    names,
    senderParties: senderParties(request?.documentType),
    generatedIdParent,
  };
}

export function normaliseXml(
  xml: string | null,
  masks: XmlMasks,
): string | null {
  if (xml === null) return null;
  let normalised = xml.replace(/\r\n/g, "\n").trim();
  normalised = maskSenderAddress(normalised, masks.senderParties);
  if (masks.generatedIdParent) {
    normalised = maskGeneratedId(normalised, masks.generatedIdParent);
  }
  for (const name of masks.names) {
    normalised = maskElement(normalised, name);
  }
  return normalised;
}

/** The first differing lines, enough to see what changed without a wall of XML. */
export function describeXmlDifference(
  expected: string,
  actual: string,
  maxLines = 10,
): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const lines: string[] = [];

  for (
    let i = 0;
    i < Math.max(expectedLines.length, actualLines.length) &&
    lines.length < maxLines * 2;
    i++
  ) {
    if (expectedLines[i] === actualLines[i]) continue;
    lines.push(`  ${i + 1} recorded: ${expectedLines[i] ?? "<end of document>"}`);
    lines.push(`  ${i + 1} replayed: ${actualLines[i] ?? "<end of document>"}`);
  }

  const suffix = lines.length >= maxLines * 2 ? "\n  ..." : "";
  return `${lines.join("\n")}${suffix}`;
}
