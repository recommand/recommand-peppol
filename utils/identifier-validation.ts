import { UserFacingError } from "@peppol/utils/util";

type IdentifierValidator = (identifier: string) => void;
type CountryIdentifierValidators = {
  vatNumber?: IdentifierValidator;
  enterpriseNumber?: IdentifierValidator;
};

function validateBelgianEnterpriseNumber(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{10}$/.test(digits)) {
    throw new UserFacingError(
      "Belgian enterprise number must be exactly 10 digits (got " +
        digits.length +
        ")"
    );
  }

  if (digits[0] !== "0" && digits[0] !== "1") {
    throw new UserFacingError(
      "Belgian enterprise number must start with 0 or 1"
    );
  }

  const base = parseInt(digits.substring(0, 8), 10);
  const checkDigits = parseInt(digits.substring(8, 10), 10);
  const expected = 97 - (base % 97);

  if (checkDigits !== expected) {
    throw new UserFacingError(
      "Belgian enterprise number has an invalid check digit"
    );
  }
}

function validateBelgianVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("BE")) {
    throw new UserFacingError("Belgian VAT number must start with 'BE'");
  }

  const numericPart = cleaned.substring(2);

  if (!/^\d{10}$/.test(numericPart)) {
    throw new UserFacingError(
      "Belgian VAT number must have exactly 10 digits after the BE prefix (got " +
        numericPart.length +
        ")"
    );
  }

  if (numericPart[0] !== "0" && numericPart[0] !== "1") {
    throw new UserFacingError(
      "Belgian VAT number must start with BE0 or BE1"
    );
  }

  const base = parseInt(numericPart.substring(0, 8), 10);
  const checkDigits = parseInt(numericPart.substring(8, 10), 10);
  const expected = 97 - (base % 97);

  if (checkDigits !== expected) {
    throw new UserFacingError(
      "Belgian VAT number has an invalid check digit"
    );
  }
}

function validateDutchEnterpriseNumber(identifier: string): void {
  const digits = identifier.replace(/[\.\-\s]/g, "");

  if (!/^\d{8}$/.test(digits)) {
    throw new UserFacingError(
      "Dutch enterprise number (KVK) must be exactly 8 digits (got " +
        digits.length +
        ")"
    );
  }
}

function validateDutchVatNumber(identifier: string): void {
  const cleaned = identifier.replace(/[\.\-\s]/g, "").toUpperCase();

  if (!cleaned.startsWith("NL")) {
    throw new UserFacingError("Dutch VAT number must start with 'NL'");
  }

  const afterPrefix = cleaned.substring(2);

  if (!/^\d{9}B\d{2}$/.test(afterPrefix)) {
    throw new UserFacingError(
      "Dutch VAT number must have the format NL + 9 digits + B + 2 digits (e.g. NL123456789B01)"
    );
  }
}

function validateDanishOrganizationNumber(identifier: string): void {
  if (!/^(DK)?\d{8}$/.test(identifier.toUpperCase())) {
    throw new UserFacingError(
      "Danish organization number (CVR) must be 8 digits, optionally prefixed with 'DK'"
    );
  }
}

const schemeValidators: Record<string, IdentifierValidator> = {
  "0184": validateDanishOrganizationNumber,
  "0208": validateBelgianEnterpriseNumber,
  "9925": validateBelgianVatNumber,
  "0106": validateDutchEnterpriseNumber,
  "9944": validateDutchVatNumber,
};

const countryValidators: Record<string, CountryIdentifierValidators> = {
  "BE": {
    vatNumber: validateBelgianVatNumber,
    enterpriseNumber: validateBelgianEnterpriseNumber,
  },
  "NL": {
    vatNumber: validateDutchVatNumber,
    enterpriseNumber: validateDutchEnterpriseNumber,
  },
};

export function validateIdentifier(
  scheme: string,
  identifier: string,
): void {
  const validator = schemeValidators[scheme];
  if (!validator) {
    return;
  }
  validator(identifier);
}

export function validateCountryIdentifier(
  country: string,
  identifiers: {
    vatNumber?: string | null;
    enterpriseNumber?: string | null;
  },
): void {
  const validator = countryValidators[country];
  if (!validator) {
    return;
  }
  if (identifiers.vatNumber && validator.vatNumber) {
    validator.vatNumber(identifiers.vatNumber);
  }
  if (identifiers.enterpriseNumber && validator.enterpriseNumber) {
    validator.enterpriseNumber(identifiers.enterpriseNumber);
  }
}
