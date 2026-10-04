import { UserFacingError } from "@peppol/utils/util";

/** Throws a UserFacingError that says what is wrong with the number. */
export type IdentifierValidator = (identifier: string) => void;

/**
 * What a country contributes to identifier validation. The country's default schemes
 * in countries.ts, and its VAT scheme in the Peppol code list, take its VAT number and
 * enterprise number validators.
 */
export type CountryIdentifierRules = {
  /** ISO 3166-1 alpha-2 code, as in countries.ts. */
  country: string;
  /** The company's VAT number, with its prefix. */
  vatNumber?: IdentifierValidator;
  /** The number the country's business register (or tax administration) identifies a company by. */
  enterpriseNumber?: IdentifierValidator;
  /** The prefixes the country's VAT numbers carry, when they are more than its code. */
  vatPrefixes?: string[];
  /** The form VAT numbers are compared in, when the country writes them in more than one. */
  normalizeVatNumber?: (vatNumber: string) => string;
  /** Further schemes of the country whose value is more than one of the numbers above. */
  schemes?: Record<string, IdentifierValidator>;
  /** Per scheme, a prefix the published identifier goes without. */
  optionalPrefixes?: Record<string, RegExp>;
  /**
   * Schemes of the country whose identifier names the company in its own way, with the
   * check that it does; they take the place of the plain comparison with its numbers.
   */
  companyIdentifiers?: {
    schemes: string[];
    validate: (scheme: string, identifier: string, company: { enterpriseNumber: string | null; vatNumber: string | null }) => void;
  };
};

/**
 * A national VAT number as VIES knows it: a country prefix, the national number and,
 * where the country published how, a check over that number. Every country's validator
 * names its source; a country whose check is not published is held to its format only.
 */
export function vatNumberValidator({
  name,
  prefixes,
  pattern,
  format,
  check,
}: {
  /** How the messages name the number's country, e.g. "Austrian". */
  name: string;
  /** The prefixes the number starts with: its VIES country code. */
  prefixes: string[];
  /** The part after the prefix. */
  pattern: RegExp;
  /** The whole format with an example, as the message describes it. */
  format: string;
  /** The national check over the part after the prefix. */
  check?: (number: string) => boolean;
}): IdentifierValidator {
  return (identifier) => {
    const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
    const prefix = prefixes.find((candidate) => cleaned.startsWith(candidate));
    if (!prefix) {
      throw new UserFacingError(
        `${name} VAT number must start with ${prefixes.map((candidate) => `'${candidate}'`).join(" or ")}`
      );
    }
    const number = cleaned.substring(prefix.length);
    if (!pattern.test(number)) {
      throw new UserFacingError(`${name} VAT number must have the format ${format}`);
    }
    if (check && !check(number)) {
      throw new UserFacingError(`${name} VAT number has an invalid check digit`);
    }
  };
}

/** A national business register or tax number, held to its format and, where published, its check. */
export function registerNumberValidator({
  name,
  pattern,
  format,
  check,
}: {
  /** The number as the messages name it, e.g. "Norwegian organisation number". */
  name: string;
  pattern: RegExp;
  /** What the message says the number must be, with an example. */
  format: string;
  check?: (number: string) => boolean;
}): IdentifierValidator {
  return (identifier) => {
    const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();
    if (!pattern.test(cleaned)) {
      throw new UserFacingError(`${name} must be ${format}`);
    }
    if (check && !check(cleaned)) {
      throw new UserFacingError(`${name} has an invalid check digit`);
    }
  };
}
