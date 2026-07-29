import type { Company } from "@peppol/data/companies";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { UserFacingError } from "@peppol/utils/util";
import type {
  CompanyIdentityRow,
  CompanyKycIdentity,
  MandateScopeItem,
} from "./mandate";

// 0225 is the French electronic address, 0002 a SIREN and 0009 a SIRET.
const FRENCH_IDENTIFIER_SCHEMES = new Set(["0225", "0002", "0009"]);

type FrenchNumberSource = {
  label: string;
  value: string | null;
};

/**
 * The leading digits of a French number. Electronic addresses may carry a
 * routing suffix (123456789_STATUTS) and numbers are written with separators.
 * Returns null when there is nothing to read, "" when the value holds no number.
 */
function frenchNumber(value: string | null | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return value.replace(/[\s.\-]/g, "").split(/\D/)[0];
}

function passesLuhn(digits: string): boolean {
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

function isSiren(digits: string): boolean {
  return /^\d{9}$/.test(digits) && passesLuhn(digits);
}

function isSiret(digits: string): boolean {
  return /^\d{14}$/.test(digits) && passesLuhn(digits);
}

/**
 * Resolves the SIREN/SIRET the KYC of a French company is filed under, from
 * everything the company told us about itself. Refuses to guess: the numbers
 * have to be well formed and agree with each other, since a wrong one ends up
 * in a filing towards the French administration.
 *
 * The one thing it does assume is the head office SIRET when the company only
 * ever gave us its SIREN, which it notes for support.
 */
export function resolveFrenchCompanyIdentity(
  company: Pick<Company, "enterpriseNumber" | "vatNumber">,
  identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
): CompanyKycIdentity {
  const sources: FrenchNumberSource[] = [
    { label: "enterprise number", value: company.enterpriseNumber },
    ...identifiers
      .filter((identifier) => FRENCH_IDENTIFIER_SCHEMES.has(identifier.scheme))
      .map((identifier) => ({
        label: `identifier ${identifier.scheme}:${identifier.identifier}`,
        value: identifier.identifier,
      })),
  ];

  const numbers: { label: string; siren: string; siret: string | null }[] = [];
  for (const source of sources) {
    const digits = frenchNumber(source.value);
    if (digits === null) {
      continue;
    }

    if (isSiret(digits)) {
      numbers.push({ label: source.label, siren: digits.slice(0, 9), siret: digits });
    } else if (isSiren(digits)) {
      numbers.push({ label: source.label, siren: digits, siret: null });
    } else {
      throw new UserFacingError(
        `The ${source.label} of this company is not a valid SIREN or SIRET`,
      );
    }
  }

  if (numbers.length === 0) {
    throw new UserFacingError(
      "Company has no SIREN or SIRET, cannot submit KYC to Arratech",
    );
  }

  const sirens = [...new Set(numbers.map((number) => number.siren))];
  if (sirens.length > 1) {
    throw new UserFacingError(
      `Company numbers name different companies: ${numbers.map((number) => `${number.label} is ${number.siren}`).join(", ")}`,
    );
  }

  const sirets = [...new Set(numbers.flatMap((number) => number.siret ?? []))];
  if (sirets.length > 1) {
    throw new UserFacingError(
      `Company covers several establishments (${sirets.join(", ")}), the KYC has to name a single SIRET`,
    );
  }

  const siren = sirens[0];
  const siret = sirets[0] ?? `${siren}00001`;
  const isSiretAssumed = sirets.length === 0;

  // An assumed head office SIRET has no place in the mandate; the SIREN, the
  // legal name and the address identify the company on their own. Arratech does
  // need one, so support is told it was assumed.
  const rows: CompanyIdentityRow[] = [{ label: "SIREN", value: siren }];
  if (!isSiretAssumed) {
    rows.push({ label: "SIRET", value: siret });
  }
  if (company.vatNumber) {
    rows.push({ label: "VAT number", value: company.vatNumber });
  }

  return {
    rows,
    metaData: { siren, siret },
    notes: isSiretAssumed
      ? [
          `SIRET ${siret} assumed to be the head office, the company only gave us its SIREN`,
        ]
      : [],
  };
}

/**
 * What the mandate of a French company states on top of, or instead of, the
 * wording that holds for any country: Arratech acts as a registered PA and the
 * company delegates the flows the French regime adds.
 */
export const FRANCE_MANDATE_COPY = {
  title: "Mandat de facturation électronique et de e-reporting",
  platformRole: "Plateforme agréée (PA)",
  platformRegistration: "3309",
  receivingDescription:
    "Receiving the electronic invoices, credit notes and lifecycle statuses (CDAR) addressed to the company's electronic addresses, on its behalf.",
  directoryDescription:
    "Registering, updating and removing the company's electronic addresses and the flows it accepts in the Peppol directory and in the French e-invoicing annuaire.",
  eReportingScopeItem: {
    title: "Transmitting e-reporting data",
    description:
      "Transmitting the company's transaction data (B2C sales) and payment data to the French tax administration.",
  } satisfies MandateScopeItem,
};
