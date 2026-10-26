import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import type { CountryIdentifierRules } from "../validators";

export function validateLuxembourgVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("LU")) {
    throw new UserFacingError("Luxembourg VAT number must start with 'LU'");
  }

  const digits = cleaned.substring(2);

  if (!/^\d{8}$/.test(digits)) {
    throw new UserFacingError(
      "Luxembourg VAT number must have the format LU + 8 digits (e.g. LU15027442)"
    );
  }

  // The last two digits are the first six modulo 89.
  if (Number(digits.substring(0, 6)) % 89 !== Number(digits.substring(6))) {
    throw new UserFacingError("Luxembourg VAT number has an invalid check digit");
  }
}

/**
 * The matricule, the number of the register of legal persons (répertoire des
 * personnes morales): 11 digits, the first four a year. Its last digit is a check
 * digit, but the algorithm is not published, so only the format is held. Source:
 * Peppol participant identifier schemes v9.7, LU:MAT.
 */
const MATRICULE = /^\d{11}$/;

/** The register of legal persons' own scheme, which takes the matricule alone. */
const MATRICULE_SCHEME = "0240";

function validateLuxembourgMatricule(identifier: string): void {
  if (!MATRICULE.test(identifier.replace(/[\.\-\s]/g, ""))) {
    throw new UserFacingError(
      `Identifier under scheme ${MATRICULE_SCHEME} must be an 11 digit Luxembourg matricule (e.g. 12345678910)`
    );
  }
}

/**
 * Luxembourg addresses every organisation under 9938, with either its VAT number or
 * its matricule: "la codelist à utiliser dans Peppol pour les 2 types de numéros est
 * toujours la liste 9938" (efacturation.public.lu, FAQ on Peppol identifiers). A value
 * of digits only is read as a matricule, anything else as a VAT number.
 */
export function validateLuxembourgPeppolIdentifier(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "");
  if (/^\d+$/.test(cleaned)) {
    if (!MATRICULE.test(cleaned)) {
      throw new UserFacingError(
        "Identifier under scheme 9938 must be a Luxembourg VAT number with its LU prefix (e.g. LU15027442) or an 11 digit matricule (e.g. 12345678910)"
      );
    }
    return;
  }
  validateLuxembourgVatNumber(identifier);
}

/**
 * An identifier under 9938 or 0240 has to be the company's own number: its VAT number
 * (9938 only), or its matricule, which a Luxembourg company records as its enterprise
 * number.
 */
function validateLuxembourgIdentifierBelongsToCompany(
  scheme: string,
  identifier: string,
  company: { enterpriseNumber: string | null; vatNumber: string | null; country?: string | null }
): void {
  const cleanedIdentifier = cleanVatNumber(identifier)!;
  const country = company.country?.toUpperCase();
  if (country && country !== "LU") {
    throw new UserFacingError(
      `Scheme ${scheme} is for ${scheme === MATRICULE_SCHEME ? "matricules" : "VAT numbers and matricules"} from Luxembourg, and a company can only register its own. Register a number from Luxembourg on a separate company in that country.`
    );
  }

  if (scheme === MATRICULE_SCHEME || MATRICULE.test(cleanedIdentifier)) {
    // Any number of 11 digits would pass the comparison below, such as an Australian
    // ABN, so a matricule is only taken from a company known to be in Luxembourg.
    if (!country) {
      throw new UserFacingError(`Company identifier with scheme ${scheme} can only be a matricule for a company in Luxembourg.`);
    }
    const companyMatricule = cleanEnterpriseNumber(company.enterpriseNumber);
    if (!companyMatricule) {
      throw new UserFacingError(
        `Company identifier with scheme ${scheme} and a matricule requires the company enterprise number to be set to that matricule.`
      );
    }
    if (cleanedIdentifier !== companyMatricule) {
      throw new UserFacingError(
        `Company identifier with scheme ${scheme} must match the company enterprise number when it is a matricule. Expected: ${companyMatricule}, got: ${cleanedIdentifier}`
      );
    }
    return;
  }

  const companyVatNumber = cleanVatNumber(company.vatNumber);
  if (!companyVatNumber) {
    throw new UserFacingError(`Company identifier with scheme ${scheme} requires a company VAT number to be set.`);
  }
  if (cleanedIdentifier !== companyVatNumber) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must match the company VAT number. Expected: ${companyVatNumber}, got: ${cleanedIdentifier}`
    );
  }
}

export const luxembourg: CountryIdentifierRules = {
  country: "LU",
  vatNumber: validateLuxembourgVatNumber,
  schemes: {
    "9938": validateLuxembourgPeppolIdentifier,
    [MATRICULE_SCHEME]: validateLuxembourgMatricule,
  },
  companyIdentifiers: {
    schemes: ["9938", MATRICULE_SCHEME],
    validate: validateLuxembourgIdentifierBelongsToCompany,
  },
};
