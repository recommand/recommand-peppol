import { UserFacingError, cleanEnterpriseNumber, cleanVatNumber } from "@peppol/utils/util";
import { registerNumberValidator, vatNumberValidator, type CountryIdentifierRules } from "../validators";

// Andorra. The NRT (número de registre tributari) is the one number the tax
// administration identifies a person or company by, for the general indirect tax
// (IGI) as for anything else: a letter for the kind of holder, 6 digits and a control
// letter. Natural persons (F) are numbered up to 699999, and resident companies (A
// for an SA, L for an SL) from 700000 to 799999. The control letter's algorithm is not
// published, so only the format is held. Sources: OECD, "Andorra - Information on Tax
// Identification Numbers"; python-stdnum (ad.nrt).
const NRT = /^(?:[CDEGOPU]\d{6}|F[0-6]\d{5}|[AL]7\d{5})[A-Z]$/;

const ANDORRAN_VAT_SCHEME = "9922";

export const validateAndorranNrt = registerNumberValidator({
  name: "Andorran NRT",
  pattern: NRT,
  format: "a letter, 6 digits and a letter (e.g. L712345A)",
});

// As a VAT number the NRT carries the country prefix.
export const validateAndorranVatNumber = vatNumberValidator({
  name: "Andorran",
  prefixes: ["AD"],
  pattern: NRT,
  format: "AD + the NRT: a letter, 6 digits and a letter (e.g. ADL712345A)",
});

/**
 * Under 9922 Andorran participants are published both ways, as the bare NRT and with
 * the AD prefix (Peppol Directory, country AD), and the code list prescribes neither.
 * Both forms are accepted; they are different addresses on the network.
 */
export function validateAndorranPeppolIdentifier(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
  if (!NRT.test(cleaned.replace(/^AD/, ""))) {
    throw new UserFacingError(
      `Identifier under scheme ${ANDORRAN_VAT_SCHEME} must be an Andorran NRT, a letter, 6 digits and a letter, with or without its AD prefix (e.g. ADL712345A)`
    );
  }
}

/**
 * The company's NRT as it is written under 9922, with its prefix: from its enterprise
 * number first, then from its VAT number. Usually one, as both hold the same NRT.
 */
function andorranVatIdentifiers(company: { enterpriseNumber: string | null; vatNumber: string | null }): string[] {
  const nrt = cleanEnterpriseNumber(company.enterpriseNumber);
  const vatNumber = cleanVatNumber(company.vatNumber);
  const candidates = [
    nrt && NRT.test(nrt) ? `AD${nrt}` : null,
    vatNumber?.startsWith("AD") && NRT.test(vatNumber.substring(2)) ? vatNumber : null,
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => !!candidate))];
}

/**
 * An identifier under 9922 has to be the company's own NRT, whichever of its two
 * numbers records it.
 */
function validateAndorranIdentifierBelongsToCompany(
  scheme: string,
  identifier: string,
  company: { enterpriseNumber: string | null; vatNumber: string | null; country?: string | null }
): void {
  const country = company.country?.toUpperCase();
  if (country && country !== "AD") {
    throw new UserFacingError(
      `Scheme ${scheme} is for tax numbers (NRT) from Andorra, and a company can only register its own. Register a number from Andorra on a separate company in that country.`
    );
  }
  const own = andorranVatIdentifiers(company);
  if (own.length === 0) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} requires the company enterprise number to be set to its NRT.`
    );
  }
  const cleanedIdentifier = cleanVatNumber(identifier)!;
  if (!own.includes(cleanedIdentifier.replace(/^(?!AD)/, "AD"))) {
    throw new UserFacingError(
      `Company identifier with scheme ${scheme} must match the company NRT. Expected: ${own.join(" or ")}, got: ${cleanedIdentifier}`
    );
  }
}

export const andorra: CountryIdentifierRules = {
  country: "AD",
  vatNumber: validateAndorranVatNumber,
  enterpriseNumber: validateAndorranNrt,
  schemes: {
    [ANDORRAN_VAT_SCHEME]: validateAndorranPeppolIdentifier,
  },
  companyIdentifiers: {
    schemes: [ANDORRAN_VAT_SCHEME],
    validate: validateAndorranIdentifierBelongsToCompany,
  },
  // 9922 is the only scheme the code list has for Andorra. A company is published
  // under it from its NRT, recorded as its enterprise number, with the AD prefix the
  // code list's VAT schemes are written with. It comes from that number so that it has an
  // address without a VAT number: an invoice that is not subject to VAT (category O)
  // may not name the seller's VAT number, and a company that sends such invoices
  // leaves that field empty.
  derivedIdentifiers: (company) =>
    andorranVatIdentifiers(company).map((identifier) => ({ scheme: ANDORRAN_VAT_SCHEME, identifier })),
};
