import { ITEM_TYPE_IDENTIFICATION_CODES } from "@peppol/utils/item-type-identification-codes";
import { getNullableTextContent, getTextContent } from "./xml-helpers";

const knownSchemes = new Set(ITEM_TYPE_IDENTIFICATION_CODES.map((code) => code.key));

/**
 * The item classifications (BT-158) of a received line. A classification is kept only
 * when it has a code and a UNCL7143 scheme (BT-158-1). UBL makes every child of
 * cac:CommodityClassification optional, so a sender can classify by cbc:NatureCode,
 * cbc:CargoTypeCode or cbc:CommodityCode alone, or send the code without its scheme.
 * Such a classification is skipped instead of failing the whole document; the XML
 * itself keeps it.
 */
function parseClassificationCode(code: any) {
  const scheme = getTextContent(code?.["@_listID"]);
  const value = getTextContent(code);
  if (!value || !knownSchemes.has(scheme)) return [];
  return [{ scheme, schemeVersion: getNullableTextContent(code["@_listVersionID"]), value }];
}

export function parseUblCommodityClassifications(classifications: any[] | undefined) {
  return (classifications || []).flatMap((classification) =>
    parseClassificationCode(classification?.ItemClassificationCode)
  );
}

export function parseCiiCommodityClassifications(classifications: any[] | undefined) {
  return (classifications || []).flatMap((classification) =>
    parseClassificationCode(classification?.ClassCode)
  );
}
