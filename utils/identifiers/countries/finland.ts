import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { passesMod11CheckDigit } from "../checksums";
import { vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Finland. The Business ID (Y-tunnus) is 7 digits and a check digit, written with a
// hyphen before the check digit; the check digit is 11 minus the sum with the weights
// 7,9,10,5,8,4,2 modulo 11, and a remainder of 1 is never issued. Source:
// Valtioneuvoston asetus 288/2001, § 4. The VAT number is FI followed by the Business
// ID without its hyphen.
const passesBusinessIdCheck = (businessId: string) => passesMod11CheckDigit(businessId, [7, 9, 10, 5, 8, 4, 2]);

export const validateFinnishVatNumber = vatNumberValidator({
  name: "Finnish",
  prefixes: ["FI"],
  pattern: /^\d{8}$/,
  format: "FI + 8 digits (e.g. FI02454583)",
  check: passesBusinessIdCheck,
});

export const FINNISH_OVT_SCHEME = "0216";

/** The OVT code is a fixed 0037, the Business ID without its hyphen and an optional suffix. */
const OVT_CODE = /^0037(\d{8})[0-9A-Z]{0,5}$/;

/**
 * The OVT code (ICD 0216, FI:OVT2), the Finnish e-invoicing address: 0037, the 8 digit
 * Business ID without its hyphen and an optional suffix of up to 5 letters or digits
 * that the organisation assigns to a department or location, 12 to 17 characters in
 * all. Source: Peppol participant identifier schemes v9.7 (issuing agency TIEKE).
 */
export function validateFinnishOvtCode(identifier: string): void {
  const match = OVT_CODE.exec(identifier.trim().toUpperCase());
  if (!match) {
    throw new UserFacingError(
      "Finnish OVT code must be 0037 followed by the 8 digit Business ID without its hyphen and an optional suffix of up to 5 letters or digits (e.g. 003702454583 or 003702454583TST01)"
    );
  }
  if (!passesBusinessIdCheck(match[1]!)) {
    throw new UserFacingError("Finnish OVT code contains a Business ID with an invalid check digit");
  }
}

/**
 * The Business IDs a company's numbers name: the one in its VAT number first, then its
 * enterprise number when that is a Business ID. Usually one, as both name the same
 * company.
 */
function finnishBusinessIds(company: { enterpriseNumber: string | null; vatNumber: string | null }): string[] {
  const vatNumber = cleanVatNumber(company.vatNumber);
  const enterpriseNumber = cleanEnterpriseNumber(company.enterpriseNumber);
  const candidates = [
    vatNumber?.startsWith("FI") ? vatNumber.substring(2) : null,
    enterpriseNumber,
  ];
  return [
    ...new Set(
      candidates.filter((candidate): candidate is string => !!candidate && /^\d{8}$/.test(candidate) && passesBusinessIdCheck(candidate))
    ),
  ];
}

/**
 * An OVT code names the company it is built from, so the Business ID in it has to be
 * the company's own. The suffix is the company's to choose.
 */
function validateOvtCodeBelongsToCompany(
  scheme: string,
  identifier: string,
  company: { enterpriseNumber: string | null; vatNumber: string | null }
): void {
  const businessIds = finnishBusinessIds(company);
  if (businessIds.length === 0) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} requires a company VAT number or enterprise number with the company's Finnish Business ID to be set.`
    );
  }
  const businessId = OVT_CODE.exec(identifier.trim().toUpperCase())?.[1];
  if (!businessId || !businessIds.includes(businessId)) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must contain the company's Business ID. Expected an OVT code starting with ${businessIds.map((id) => `0037${id}`).join(" or ")}, got: ${identifier}`
    );
  }
}

export const finland: CountryIdentifierRules = {
  country: "FI",
  vatNumber: validateFinnishVatNumber,
  schemes: {
    [FINNISH_OVT_SCHEME]: validateFinnishOvtCode,
  },
  companyIdentifiers: {
    schemes: [FINNISH_OVT_SCHEME],
    validate: validateOvtCodeBelongsToCompany,
  },
  // Finnish companies are addressed by their OVT code; the VAT number has no Peppol
  // scheme since the code list removed 0213.
  derivedIdentifiers: (company) => {
    const [businessId] = finnishBusinessIds(company);
    return businessId ? [{ scheme: FINNISH_OVT_SCHEME, identifier: `0037${businessId}` }] : [];
  },
};
