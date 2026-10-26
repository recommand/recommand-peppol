/**
 * XRechnung 3.0, the German CIUS of EN 16931 maintained by KoSIT, in the two syntaxes
 * Peppol carries it in. The specification identifier (BT-24) names the major version
 * only, so 3.0.x documents all carry the same identifier and document type
 * identifiers; validation pins the exact release. The extension
 * (`#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0`) and earlier versions
 * are not formats of their own: sent as raw XML they travel under the document type
 * identifier they declare, and received they are stored unparsed.
 */
export const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

export const XRECHNUNG_PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
