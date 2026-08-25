import type { Company } from "@peppol/data/companies";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { FRENCH_MANDATE_TEMPLATE } from "@peppol/templates/mandate-fr";
import { UserFacingError } from "@peppol/utils/util";
import { formatMandateDate, MANDATARY, OPERATOR } from "./shared";
import {
  type CompanyIdentityRow,
  type CompanyIdentitySource,
  type CompanyKycIdentity,
  type MandateDocument,
  type MandateInput,
} from "../mandate";

const TIME_ZONE = "Europe/Paris";

const TITLE = "Mandat de désignation de plateforme agréée";

// 0225 is the French electronic address, 0002 a SIREN and 0009 a SIRET.
const FRENCH_IDENTIFIER_SCHEMES = new Set(["0225", "0002", "0009"]);

/**
 * Arratech AB is a Swedish company and has no SIREN, so the FNFE model
 * identifies it by the matricule it was assigned as a Plateforme Agréée.
 */
const PLATFORM = {
  legalName: MANDATARY.legalName,
  siren: null as string | null,
  matricule: "0153",
};

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
  company: Pick<CompanyIdentitySource, "enterpriseNumber" | "vatNumber">,
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
 * The Annuaire form of an electronic address, which is the identifier without
 * its Peppol scheme. A SIRET registered on its own is written SIREN_SIRET.
 * Returns null for anything that is not a French address.
 */
function toAnnuaireAddress(
  identifier: Pick<CompanyIdentifier, "scheme" | "identifier">,
): string | null {
  if (!FRENCH_IDENTIFIER_SCHEMES.has(identifier.scheme)) {
    return null;
  }
  const value = identifier.identifier.replace(/[\s.]/g, "");
  if (identifier.scheme !== "0225" && /^\d{14}$/.test(value)) {
    return `${value.slice(0, 9)}_${value}`;
  }
  return value;
}

/**
 * The four categories of block 4 of the FNFE model, in the order the model
 * lists them. An address belongs to the first one whose form it matches, so
 * the more specific forms are tested first.
 */
const ADDRESS_CATEGORIES = [
  {
    key: "principale",
    label: "Mon adresse électronique principale (SIREN)",
    matches: (address: string) => /^\d{9}$/.test(address),
  },
  {
    key: "fonctionnelle",
    label:
      "Adresses électroniques fonctionnelles de la forme SIREN_SUFFIXE (par exemple SIREN_ACHATTYPE1, SIREN_XXX signifiant toutes les adresses de ce type)",
    matches: (address: string) => /^\d{9}_[^_]+$/.test(address),
  },
  {
    key: "etablissement",
    label:
      "Adresses électroniques secondaires d'établissements (SIREN_SIRET, SIREN_XXX signifiant tous les SIRET existants à venir)",
    matches: (address: string) => /^\d{9}_\d{14}$/.test(address),
  },
  {
    key: "additionnelle",
    label:
      "Adresses électroniques additionnelles dans chaque établissement (SIREN_SIRET_CODEROUTAGE, XXX signifiant tout CODE_ROUTAGE existant à venir)",
    matches: (address: string) => /^\d{9}_\d{14}_.+$/.test(address),
  },
] as const;

const SPECIFIC_CATEGORIES_FIRST = [...ADDRESS_CATEGORIES].reverse();

function classifyAddress(address: string): string {
  const category = SPECIFIC_CATEGORIES_FIRST.find((candidate) =>
    candidate.matches(address),
  );
  if (!category) {
    throw new UserFacingError(
      `Electronic address ${address} does not have a form the French annuaire accepts`,
    );
  }
  return category.key;
}

/**
 * The addresses of block 4, in the Annuaire form and all belonging to the SIREN
 * the mandate is drawn up for.
 */
function resolveAnnuaireAddresses(
  identifiers: Pick<CompanyIdentifier, "scheme" | "identifier">[],
  siren: string,
): string[] {
  const addresses = identifiers
    .map(toAnnuaireAddress)
    .filter((address): address is string => address !== null);

  if (addresses.length === 0) {
    throw new UserFacingError(
      "Company has no French electronic address to register in the annuaire",
    );
  }

  for (const address of addresses) {
    if (!address.startsWith(siren)) {
      throw new UserFacingError(
        `Electronic address ${address} does not belong to SIREN ${siren}`,
      );
    }
  }

  return [...new Set(addresses)];
}

function readSiren(identity: CompanyKycIdentity): string {
  const siren = identity.metaData?.siren;
  if (!siren) {
    throw new UserFacingError(
      "Company has no SIREN, cannot draw up the French mandate",
    );
  }
  return siren;
}

/**
 * The delegations that the FNFE model does not cover. It designates a reception
 * platform and nothing else, so sending and e-reporting are agreed in an annex
 * rather than smuggled into blocks 1 to 7.
 */
function buildAnnexItems(company: Company) {
  const items = [
    {
      title: "Transmission des données de e-reporting",
      description:
        "Transmettre à l'administration fiscale les données de transaction (ventes B2C et opérations internationales) et les données d'encaissement de l'Assujetti.",
    },
  ];

  if (company.accessPointProvider === "at-shared-ap") {
    items.unshift({
      title: "Émission de factures électroniques",
      description:
        "Transmettre, au nom et pour le compte de l'Assujetti, les factures, notes de crédit et statuts de cycle de vie qu'il émet vers les plateformes de ses partenaires commerciaux.",
    });
  }

  return items;
}

export type FrenchMandateTemplateData = {
  title: string;
  subtitle: string;
  reference: string;
  issueDate: string;
  assujetti: {
    legalName: string;
    siren: string;
    street: string;
    postalCode: string;
    city: string;
    countryName: string;
  };
  platform: {
    legalName: string;
    siren: string | null;
    matricule: string;
  };
  platformNumberFootnote: string;
  effectiveDate: string;
  addressCategories: {
    label: string;
    isChecked: boolean;
    addresses: { value: string }[];
  }[];
  previousPlatform: {
    legalName: string;
    siren: string | null;
    matricule: string | null;
  } | null;
  mandateNumbers: { address: string; value: string }[];
  signatory: {
    firstName: string;
    lastName: string;
    role: string;
    signedAt: string;
    proofMethod: string;
    /** Null while the mandate is still the draft the signatory is reading. */
    proofReference: string | null;
  };
  annex: {
    intro: string;
    items: { title: string; description: string }[];
  } | null;
  operatorNote: string;
};

export function buildFrenchMandateTemplateData(
  input: MandateInput,
): FrenchMandateTemplateData {
  const { company, identifiers, identity, signatory, signedAt } = input;

  const siren = readSiren(identity);
  const addresses = resolveAnnuaireAddresses(identifiers, siren);
  const effectiveDate = formatMandateDate(signedAt, TIME_ZONE, "dd/MM/yyyy");
  const mandateDate = formatMandateDate(signedAt, TIME_ZONE, "yyyyMMdd");
  const platformNumber = PLATFORM.siren ?? PLATFORM.matricule;

  const categorised = addresses.map((address) => ({
    address,
    key: classifyAddress(address),
  }));

  const annexItems = buildAnnexItems(company);

  return {
    title: TITLE,
    subtitle:
      "Accord formel de désignation de la plateforme de réception des factures et de demande de mise à jour des adresses de facturation électronique de réception de factures",
    reference: input.reference,
    issueDate: effectiveDate,
    assujetti: {
      legalName: company.name,
      siren,
      street: company.address,
      postalCode: company.postalCode,
      city: company.city,
      countryName: "France",
    },
    platform: PLATFORM,
    platformNumberFootnote:
      "Le numéro de SIREN est obligatoire si la PA en a un. À défaut, le numéro de matricule est obligatoire.",
    effectiveDate,
    addressCategories: ADDRESS_CATEGORIES.map((category) => {
      const matching = categorised.filter((entry) => entry.key === category.key);
      return {
        label: category.label,
        isChecked: matching.length > 0,
        addresses: matching.map((entry) => ({ value: entry.address })),
      };
    }),
    // We never take over from an incumbent PA today; the block stays on the
    // document and is filled as soon as a transfer is declared.
    previousPlatform: null,
    mandateNumbers: addresses.map((address, index) => ({
      address,
      value: `${siren}_${platformNumber}_${mandateDate}_${String(index + 1).padStart(2, "0")}`,
    })),
    signatory: {
      firstName: signatory.firstName,
      lastName: signatory.lastName,
      role: signatory.role,
      signedAt: formatMandateDate(signedAt, TIME_ZONE, "dd/MM/yyyy 'à' HH:mm"),
      proofMethod: "Didit (vérification d'identité électronique)",
      proofReference: input.proofReference,
    },
    annex: annexItems.length
      ? {
          intro: `Les délégations ci-dessous complètent la désignation de plateforme figurant aux blocs 1 à 7. Elles ne font pas partie du modèle de la FNFE et sont conclues entre l'Assujetti et la Plateforme Agréée par l'intermédiaire de ${OPERATOR.name}.`,
          items: annexItems,
        }
      : null,
    operatorNote: `Mandat conclu par l'intermédiaire de ${OPERATOR.name}, opérateur de facturation électronique.`,
  };
}

export const FRENCH_MANDATE_DOCUMENT: MandateDocument = {
  title: TITLE,
  defaultSignatoryRole: "Représentant légal",
  resolveIdentity: resolveFrenchCompanyIdentity,
  template: FRENCH_MANDATE_TEMPLATE,
  buildTemplateData: buildFrenchMandateTemplateData,
};
