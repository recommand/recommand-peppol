import { getTextContent } from "@peppol/utils/parsing/xml-helpers";
import { parseXmlForDetection } from "@peppol/utils/type-repository/document-formats/xml-detection";
import { SendingFailure } from "./errors";

/**
 * The Peppol BIS specifications, by the customization id a document names them with,
 * whose document carries the process it belongs to as its profile identifier (UBL
 * `cbc:ProfileID`, CII `ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID`):
 * "Valid document instances shall contain corresponding Business process type and
 * Specification identifier" (https://docs.peppol.eu/poacc/billing/3.0/bis/; the MLR and
 * Invoice Response BIS say "corresponding ProfileID and CustomizationID").
 *
 * Only these are compared. A national CIUS such as XRechnung or NLCIUS, generic
 * EN 16931 and the French CIUS and Extended profiles leave their profile identifier to
 * national rules or use it for something else, a French billing framework code say, so
 * what they declare there says nothing about the process they travel over.
 */
const PEPPOL_BIS_CUSTOMIZATION_IDS = new Set([
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:selfbilling:3.0",
  "urn:fdc:peppol.eu:poacc:trns:mlr:3",
  "urn:fdc:peppol.eu:poacc:trns:invoice_response:3",
]);

/**
 * The processes of those specifications, each of which carries only documents that
 * declare it. A process left out is never compared, which is what keeps every other
 * pairing sendable: the French processes, which carry Peppol BIS documents declaring
 * the BIS process, Billing with Response, which carries Peppol BIS Billing documents as
 * well, and any version or national process this list does not know.
 */
const PEPPOL_BIS_PROCESS_IDS = new Set([
  "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
  "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0",
  "urn:fdc:peppol.eu:poacc:bis:mlr:3",
  "urn:fdc:peppol.eu:poacc:bis:invoice_response:3",
]);

/** A process id without the identifier scheme in front of it or surrounding whitespace. */
function processIdValue(processId: string): string {
  return processId.trim().replace(/^[A-Za-z0-9._-]+::/, "");
}

/** The text of an element that occurs once, or nothing for a repeated or empty one. */
function singleText(value: unknown): string | undefined {
  if (Array.isArray(value)) return undefined;
  return getTextContent(value).trim() || undefined;
}

/**
 * The Peppol BIS profile a document declares and where it declares it, or nothing
 * when the document is not a Peppol BIS document or does not state exactly one.
 */
function declaredPeppolBisProfile(
  xml: string,
): { value: string; element: string } | undefined {
  const parsed = parseXmlForDetection(xml);
  if (!parsed) return undefined;

  const root = Object.entries(parsed).find(
    ([name, content]) => !name.startsWith("?") && content && typeof content === "object",
  )?.[1];
  if (!root) return undefined;

  if (root.CustomizationID !== undefined) {
    const customizationId = singleText(root.CustomizationID);
    if (!customizationId || !PEPPOL_BIS_CUSTOMIZATION_IDS.has(customizationId)) return undefined;
    const value = singleText(root.ProfileID);
    return value ? { value, element: "cbc:ProfileID" } : undefined;
  }

  const context = root.ExchangedDocumentContext;
  if (!context || Array.isArray(context)) return undefined;
  const guideline = context.GuidelineSpecifiedDocumentContextParameter;
  const guidelineId = Array.isArray(guideline) ? undefined : singleText(guideline?.ID);
  if (!guidelineId || !PEPPOL_BIS_CUSTOMIZATION_IDS.has(guidelineId)) return undefined;
  const businessProcess = context.BusinessProcessSpecifiedDocumentContextParameter;
  const value = Array.isArray(businessProcess) ? undefined : singleText(businessProcess?.ID);
  return value
    ? { value, element: "ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID" }
    : undefined;
}

/**
 * Refuses raw XML whose requested process contradicts the process the document
 * declares for itself. The requested process goes into the envelope and the AS4
 * message, which is what the receiving access point routes the document on, while
 * the document names the process it was written for: when the two are different
 * Peppol BIS processes, it is delivered to a process it does not belong to.
 *
 * Only an unambiguous contradiction is refused: a Peppol BIS document whose profile
 * and requested process are both in `PEPPOL_BIS_PROCESS_IDS` and differ. Anything
 * else, a document without a profile, one that cannot be parsed, another
 * specification or a process this check does not know, is sent as before.
 */
export function assertProcessIdMatchesDocument(xml: string, processId: string): void {
  const requested = processIdValue(processId);
  if (!PEPPOL_BIS_PROCESS_IDS.has(requested)) return;

  const declared = declaredPeppolBisProfile(xml);
  if (!declared || !PEPPOL_BIS_PROCESS_IDS.has(declared.value)) return;
  if (declared.value === requested) return;

  throw new SendingFailure(
    `The processId '${processId}' does not match the process the XML document declares in ${declared.element}: '${declared.value}'. ` +
      `Send the document with processId '${declared.value}', or correct ${declared.element} if the document belongs to '${requested}'.`,
    400,
  );
}
