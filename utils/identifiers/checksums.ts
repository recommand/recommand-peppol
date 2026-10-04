// The check digit algorithms the national validators share.

/** The Luhn checksum: SIREN, SIRET, the Swedish organisationsnummer, the partita IVA. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The sum of the digits, each multiplied by the weight in the same position. */
export function weightedSum(digits: string, weights: number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index++) {
    sum += (digits.charCodeAt(index) - 48) * weights[index]!;
  }
  return sum;
}

/**
 * The weighted modulo 11 check digit several registers use: 11 minus the remainder,
 * 0 for remainder 0. A result of 10 is never issued, so such a number is refused.
 */
export function passesMod11CheckDigit(digits: string, weights: number[]): boolean {
  const remainder = weightedSum(digits, weights) % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected !== 10 && expected === digits.charCodeAt(weights.length) - 48;
}

/** ISO/IEC 7064 MOD 11,10: whether the last digit is the check digit over the others. */
export function passesMod11_10(digits: string): boolean {
  let product = 10;
  for (let index = 0; index < digits.length - 1; index++) {
    let sum = (digits.charCodeAt(index) - 48 + product) % 10;
    if (sum === 0) {
      sum = 10;
    }
    product = (2 * sum) % 11;
  }
  return (11 - product) % 10 === digits.charCodeAt(digits.length - 1) - 48;
}

/** ISO/IEC 7064 MOD 97-10 over a string of digits: 1 when its check digits are right. */
export function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/** Letters as the two digit numbers MOD 97-10 reads them as: A is 10, Z is 35. */
export function lettersToDigits(value: string): string {
  return value.toUpperCase().replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
}
