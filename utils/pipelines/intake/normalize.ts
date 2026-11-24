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
  HOUR: "HUR",
  HOURS: "HUR",
  DAYS: "DAY",
  DAG: "DAY",
  DAGEN: "DAY",
  MONTH: "MON",
  MONTHS: "MON",
  MAAND: "MON",
  MAANDEN: "MON",
  YEAR: "ANN",
  YEARS: "ANN",
  JAAR: "ANN",
  MB: "4L",
  GB: "E34",
  TB: "E35",
  "%": "P1",
};

/** Whether a value is a UN/ECE Recommendation 20 unit code. */
export function isUnitCode(value: string) {
  return VALID_UNIT_CODES.has(value);
}

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
 * A placeholder that a model can write for a value that is not printed, such as
 * `<UNKNOWN>` or `N/A`. No document prints it as a value, so it becomes empty, as the
 * UBL parser writes a value that a received document leaves out.
 */
const PLACEHOLDER = /^\s*(<[^<>]*>|n\/a)\s*$/i;

/**
 * Write the values of an extracted document in the form that the formats require, where
 * the document prints them in another form: a registration or VAT number with dots or
 * spaces, and a unit as its printed abbreviation. Generic: it reads only field names
 * that every document type uses with the same meaning. The type can add its own
 * normalization (`aiIntake.normalize`).
 */
export function normalizeExtractedDocument(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (PLACEHOLDER.test(value)) {
      return "";
    }
    return key && NORMALIZERS[key] ? NORMALIZERS[key](value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeExtractedDocument(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalizeExtractedDocument(item, name)]));
}
