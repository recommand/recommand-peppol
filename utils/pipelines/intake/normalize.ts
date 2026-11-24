import { z } from "zod";
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

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.every(isEmpty);
  if (typeof value === "object") return Object.values(value).every(isEmpty);
  return false;
}

/** A schema without its wrappers, and whether a wrapper lets the value be left out. */
function unwrap(schema: z.ZodTypeAny): { base: z.ZodTypeAny; optional: boolean } {
  let base = schema;
  let optional = false;
  for (;;) {
    if (base instanceof z.ZodOptional || base instanceof z.ZodNullable) {
      optional = true;
      base = base.unwrap();
    } else if (base instanceof z.ZodDefault) {
      base = base.removeDefault();
    } else if (base instanceof z.ZodEffects) {
      base = base.innerType();
    } else {
      return { base, optional };
    }
  }
}

/**
 * The document without the optional objects that state nothing, read from the type's
 * schema. Generic: it reads nothing but the schema. The schema refuses such an object (a period needs a date, a VAT entry its
 * category and rate, a referenced party a name or an identifier), and a model can write
 * one for a value that the document does not print. A required object, such as a party
 * that the type requires, stays, so the schema still reports it.
 */
export function withoutEmptyObjects(value: unknown, schema: z.ZodTypeAny): unknown {
  const { base, optional } = unwrap(schema);
  if (base instanceof z.ZodArray) {
    return Array.isArray(value) ? value.map((item) => withoutEmptyObjects(item, base.element)) : value;
  }
  if (!(base instanceof z.ZodObject) || !value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  if (optional && isEmpty(value)) {
    return null;
  }
  const shape = base.shape as Record<string, z.ZodTypeAny>;
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, shape[name] ? withoutEmptyObjects(item, shape[name]) : item]),
  );
}
