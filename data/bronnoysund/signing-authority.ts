import { namesMatch } from "@peppol/utils/names-match";
import { getBronnoysundJson, type BronnoysundClientOptions } from "./client";

// Who may act for a Norwegian organisation, from the open lookup service of the
// Brønnøysund Register Centre (fullmakt). Signature (signatur) is the authority to
// act and sign for the organisation in everything; procuration (prokura) covers its
// day-to-day business. Both can be held alone or only jointly with others.

export type SigningPerson = {
  name: string;
  /** The role code, for example DAGL (daglig leder) or LEDE (styrets leder). */
  role: string;
};

export type SigningCombination = {
  /** The rule, for example STYR (the board jointly) or R0002 (daglig leder alone). */
  code: string;
  description: string;
  persons: SigningPerson[];
};

/** What Enhetsregisteret says about one type of authority: signatur or prokura. */
export type SigningAuthorityRecord = {
  /** OK when the register could interpret the authority for this organisation. */
  routineStatus: string;
  combinations: SigningCombination[];
  /** People whose role can carry the authority, when no combination could be derived. */
  possibleSignatories: SigningPerson[];
};

export type SigningAuthority = {
  signature: SigningAuthorityRecord | null;
  procuration: SigningAuthorityRecord | null;
};

type FullmaktPerson = { navn?: string; rolle?: { kode?: string } };
type FullmaktResponse = {
  signeringsGrunnlag?: {
    muligeSigneringsRoller?: { personRolleGrunnlag?: FullmaktPerson[] };
  };
  signeringsKombinasjon?: {
    kombinasjon?: Array<{ kode?: string; tekstforklaring?: string; personRolleKombinasjon?: FullmaktPerson[] }>;
  };
  status?: { rutineStatus?: { kode?: string } };
};

function toPersons(persons: FullmaktPerson[] | undefined): SigningPerson[] {
  return (persons ?? []).flatMap((person) =>
    person.navn ? [{ name: person.navn, role: person.rolle?.kode ?? "" }] : []
  );
}

export function parseSigningAuthorityRecord(response: FullmaktResponse): SigningAuthorityRecord {
  return {
    routineStatus: response.status?.rutineStatus?.kode ?? "",
    combinations: (response.signeringsKombinasjon?.kombinasjon ?? []).map((combination) => ({
      code: combination.kode ?? "",
      description: combination.tekstforklaring ?? "",
      persons: toPersons(combination.personRolleKombinasjon),
    })),
    possibleSignatories: toPersons(response.signeringsGrunnlag?.muligeSigneringsRoller?.personRolleGrunnlag),
  };
}

/**
 * Who may sign for the organisation (signatur) and who holds procuration (prokura),
 * as the register's open lookup service reports it. That variant gives dates of
 * birth rather than national identity numbers.
 */
export async function fetchSigningAuthority(
  organisationNumber: string,
  options: BronnoysundClientOptions = {}
): Promise<SigningAuthority> {
  const number = encodeURIComponent(organisationNumber);
  const [signature, procuration] = await Promise.all([
    getBronnoysundJson<FullmaktResponse>(`/fullmakt/enheter/${number}/signatur`, options),
    getBronnoysundJson<FullmaktResponse>(`/fullmakt/enheter/${number}/prokura`, options),
  ]);
  return {
    signature: signature ? parseSigningAuthorityRecord(signature) : null,
    procuration: procuration ? parseSigningAuthorityRecord(procuration) : null,
  };
}

// Rules under which every person in a combination may act alone. Under any other
// rule a combination of several people only binds the organisation when they act
// together; a combination of one person always lets that person act alone.
const SOLE_AUTHORITY_CODES = new Set([
  "SIGN", // signatur
  "SIHV", // signatur hver for seg
  "PROK", // prokura
  "POHV", // prokura hver for seg
  "DELT", // deltakerne hver for seg
  "INNH", // innehaver
  "R0001", // styrets leder alene
  "R0002", // daglig leder alene
  "R0006", // styrets medlemmer hver for seg
  "R0007", // daglig leder eller styrets leder alene
  "R0010", // deltakerne hver for seg
  "R0011", // styrets leder og nestleder hver for seg
  "R0013", // daglig leder alene eller styrets medlemmer hver for seg
]);

export type SigningAuthorityAssessment =
  /** The person may act for the organisation alone. */
  | { kind: "sole"; authority: "signature" | "procuration"; role: string; rule: string }
  /** The person may only act together with others. */
  | { kind: "joint"; authority: "signature" | "procuration"; rule: string }
  /** The register cannot say; the person holds a role that can carry the authority. */
  | { kind: "undetermined"; reason: string }
  /** The person is not among those who can act for the organisation. */
  | { kind: "none" };

function samePerson(person: SigningPerson, name: { firstName: string; lastName: string }): boolean {
  return namesMatch(person.name, `${name.firstName} ${name.lastName}`);
}

/**
 * Whether the named person may act for the organisation according to the register.
 * Signature and procuration are both considered, and the strongest authority wins:
 * acting alone, then acting jointly. Where the register could not interpret the
 * organisation's rules, a person in a role that can carry them is undetermined
 * rather than refused, and so is everyone when the register returns nobody at all.
 */
export function assessSigningAuthority(
  authority: SigningAuthority,
  name: { firstName: string; lastName: string }
): SigningAuthorityAssessment {
  const records = [
    { kind: "signature" as const, record: authority.signature },
    { kind: "procuration" as const, record: authority.procuration },
  ];

  let joint: SigningAuthorityAssessment | null = null;
  for (const { kind, record } of records) {
    for (const combination of record?.combinations ?? []) {
      const person = combination.persons.find((candidate) => samePerson(candidate, name));
      if (!person) {
        continue;
      }
      if (combination.persons.length === 1 || SOLE_AUTHORITY_CODES.has(combination.code)) {
        return { kind: "sole", authority: kind, role: person.role, rule: combination.description || combination.code };
      }
      joint ??= { kind: "joint", authority: kind, rule: combination.description || combination.code };
    }
  }
  if (joint) {
    return joint;
  }

  const possible = records.flatMap(({ record }) => record?.possibleSignatories ?? []);
  if (possible.some((person) => samePerson(person, name))) {
    return { kind: "undetermined", reason: "the person holds a role that can carry signing authority, but the register could not derive who may sign" };
  }
  const anyoneKnown =
    possible.length > 0 ||
    records.some(({ record }) => (record?.combinations ?? []).some((combination) => combination.persons.length > 0));
  if (!anyoneKnown) {
    return { kind: "undetermined", reason: "the register returned no one who can sign for the organisation" };
  }
  return { kind: "none" };
}
