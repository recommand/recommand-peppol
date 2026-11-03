import { UNIT_CODES } from "@peppol/utils/unit-codes";
import { cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";

const VALID_UNIT_CODES = new Set(UNIT_CODES.map((unit) => unit.code));

/**
 * Unit abbreviations that documents print, with the UN/ECE Recommendation 20 code they
 * mean. Only a value that is not a valid code is replaced, so a valid code keeps its
 * meaning.
 */
const UNIT_ALIASES: Record<string, string> = {
  KG: "KGM",
  G: "GRM",
  GR: "GRM",
  T: "TNE",
  TON: "TNE",
  L: "LTR",
  LT: "LTR",
  M: "MTR",
  M2: "MTK",
  M3: "MTQ",
  KM: "KMT",
  H: "HUR",
  HR: "HUR",
  HRS: "HUR",
  UUR: "HUR",
  PC: "H87",
  PCE: "H87",
  PCS: "H87",
  ST: "H87",
  STUK: "H87",
  STUKS: "H87",
  PIECE: "H87",
  PIECES: "H87",
  EACH: "H87",
};

function unitCode(value: string) {
  const code = value.trim().toUpperCase();
  if (VALID_UNIT_CODES.has(code)) {
    return code;
  }
  return UNIT_ALIASES[code] ?? value;
}

const NORMALIZERS: Record<string, (value: string) => string | null | undefined> = {
  enterpriseNumber: cleanEnterpriseNumber,
  vatNumber: cleanVatNumber,
  unitCode,
};

/**
 * Write the values of an extracted document in the form that the formats require, where
 * the document prints them in another form: a registration or VAT number with dots or
 * spaces, and a unit as its printed abbreviation. Generic: it reads only field names
 * that every document type uses with the same meaning. The class of the type can add
 * its own normalization (see `checks`).
 */
export function normalizeExtractedDocument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeExtractedDocument);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && NORMALIZERS[key] ? NORMALIZERS[key](item) : normalizeExtractedDocument(item),
    ]),
  );
}
