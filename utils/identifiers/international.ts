import { UserFacingError } from "@peppol/utils/util";
import { mod97, lettersToDigits } from "./checksums";

/** A GS1 Global Location Number: 13 digits, the last a GS1 modulo 10 check digit. */
export function validateGln(identifier: string): void {
  const digits = identifier.replace(/[\s-]/g, "");

  if (!/^\d{13}$/.test(digits)) {
    throw new UserFacingError(
      "GLN must be exactly 13 digits (got " + digits.length + ")"
    );
  }

  let sum = 0;
  for (let index = 0; index < 12; index++) {
    sum += (digits.charCodeAt(index) - 48) * (index % 2 === 0 ? 1 : 3);
  }

  if ((10 - (sum % 10)) % 10 !== digits.charCodeAt(12) - 48) {
    throw new UserFacingError("GLN has an invalid check digit");
  }
}

/** An IBAN: country code, two check digits and up to 30 letters or digits. */
export function validateIban(identifier: string): void {
  const value = identifier.replace(/\s/g, "").toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) {
    throw new UserFacingError(
      "IBAN must start with a 2 letter country code and 2 check digits, followed by the account number (e.g. DE89370400440532013000)"
    );
  }

  if (mod97(lettersToDigits(value.substring(4) + value.substring(0, 4))) !== 1) {
    throw new UserFacingError("IBAN has invalid check digits");
  }
}
