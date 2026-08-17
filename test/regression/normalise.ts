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

export function normaliseResponseBody(body: any, emails: EmailMap): any {
  if (!body || typeof body !== "object") return body;

  const normalised: Record<string, unknown> = { ...body };
  for (const field of VOLATILE_RESPONSE_FIELDS) {
    if (field in normalised) normalised[field] = `[${field}]`;
  }
  if (Array.isArray(normalised.emailRecipients)) {
    normalised.emailRecipients = normalised.emailRecipients.map((recipient) =>
      typeof recipient === "string" ? emails.replace(recipient) : recipient,
    );
  }
  return canonicalise(normalised);
}

/**
 * Where the replay sends the mail a recorded request asked for.
 *
 * Recorded requests carry the real addresses of real customers. Replaying them
 * as they stand would mail those people again, so every address is swapped for
 * a blackhole address before the request goes out, and the same swap is
 * applied to the recorded response so `emailRecipients` still lines up.
 */
export class EmailMap {
  private readonly byAddress = new Map<string, string>();

  constructor(recipients: string[], domain: string) {
    recipients.forEach((recipient, index) => {
      if (typeof recipient !== "string" || this.byAddress.has(recipient)) return;
      this.byAddress.set(recipient, `regression+${index + 1}@${domain}`);
    });
  }

  replace(address: string): string {
    return this.byAddress.get(address) ?? address;
  }

  get size(): number {
    return this.byAddress.size;
  }
}

export function rewriteRequest(request: any, emails: EmailMap): any {
  if (!request?.email?.to || !Array.isArray(request.email.to)) return request;
  return {
    ...request,
    email: {
      ...request.email,
      to: request.email.to.map((address: unknown) =>
        typeof address === "string" ? emails.replace(address) : address,
      ),
    },
  };
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

/** The elements that carry a Peppol address, in UBL and in CII. */
const ENDPOINT_ELEMENTS = ["EndpointID", "URIID"];

/** `<cbc:EndpointID schemeID="0208">0659689080</cbc:EndpointID>` → `0208:0659689080`. */
function endpointAddress(element: string): string {
  const scheme = element.match(/schemeID="([^"]*)"/)?.[1];
  const identifier = element.replace(/<[^>]*>/g, "").trim();
  return scheme ? `${scheme}:${identifier}` : identifier;
}

/**
 * Masks the Peppol address of the company doing the sending, scheme included.
 *
 * The scheme has to go with it: a playground company is registered under a
 * different one than the production company that recorded the send — a
 * `0208:` enterprise number where the recording had a `9925:` VAT number — so
 * masking only the identifier leaves the attribute to fail on.
 *
 * Which party holds the sender depends on the document: on an invoice it is
 * the supplier, on a self-billing invoice the customer, and other document
 * types put it elsewhere again. Rather than enumerate that, the one address
 * the *request* decided — the recipient — is left to be compared as it stands,
 * and every other address in the document is masked. A recipient that the
 * request wrote in some other form than the document does simply fails to
 * match, and its endpoint is masked too, which is the safe way round.
 */
function maskSenderAddress(xml: string, recipient: string | null): string {
  let masked = xml;
  for (const name of ENDPOINT_ELEMENTS) {
    masked = masked.replace(elementPattern(name), (match, tag) =>
      recipient !== null && endpointAddress(match) === recipient
        ? match
        : `<${tag}>[masked ${name}]</${tag}>`,
    );
  }
  return masked;
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
  /** Whether the sending company's own Peppol address is masked. */
  senderAddress: boolean;
  /** The address the request asked for: the one that stays compared. */
  recipient: string | null;
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
    return { names: [], senderAddress: false, recipient: null };
  }

  const document = request?.document ?? {};
  const names: string[] = [...ENVIRONMENT_ELEMENTS.always];
  for (const field of ["seller", "buyer", "issueDate", "dueDate"] as const) {
    if (omitted(document, field)) {
      names.push(...ENVIRONMENT_ELEMENTS[field]);
    }
  }
  return {
    names,
    senderAddress: true,
    recipient:
      typeof request?.recipient === "string" ? request.recipient.trim() : null,
  };
}

export function normaliseXml(
  xml: string | null,
  masks: XmlMasks,
): string | null {
  if (xml === null) return null;
  let normalised = xml.replace(/\r\n/g, "\n").trim();
  if (masks.senderAddress) {
    normalised = maskSenderAddress(normalised, masks.recipient);
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
