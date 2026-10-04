/**
 * The national VAT number schemes of the Peppol participant identifier code list (v9.7),
 * by the country whose VAT numbers they take. Most are no country's default here, but an
 * identifier under any of them is still a VAT number, held to that country's format and
 * to the company's own VAT number.
 */
export const PEPPOL_VAT_SCHEMES: Record<string, string> = {
  "0211": "IT", "9909": "NO", "9910": "HU", "9914": "AT", "9920": "ES", "9922": "AD",
  "9923": "AL", "9924": "BA", "9925": "BE", "9926": "BG", "9927": "CH", "9928": "CY",
  "9929": "CZ", "9930": "DE", "9931": "EE", "9932": "GB", "9933": "GR", "9934": "HR",
  "9935": "IE", "9936": "LI", "9937": "LT", "9938": "LU", "9939": "LV", "9940": "MC",
  "9941": "ME", "9942": "MK", "9943": "MT", "9944": "NL", "9945": "PL", "9946": "PT",
  "9947": "RO", "9948": "RS", "9949": "SI", "9950": "SK", "9951": "SM", "9952": "TR",
  "9953": "VA", "9957": "FR", "0248": "OM",
};

/**
 * Schemes the code list removed, which the Peppol Policy for use of identifiers (4a)
 * forbids using at all, with the scheme that replaced them. 9958 has its own message.
 */
export const REMOVED_SCHEMES: Record<string, string> = {
  "0213": "Finnish VAT numbers are no longer a Peppol scheme.",
  "9906": "Italian VAT numbers use scheme 0211.",
  "9955": "Swedish companies are addressed by their organisation number under scheme 0007.",
};
