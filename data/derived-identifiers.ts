import { companyIdentifiers } from "@peppol/db/schema";
import { derivedDefaultIdentifiers } from "@peppol/utils/identifier-validation";
import { db } from "@recommand/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Company } from "./companies";
import { canUpsertCompanyIdentifier, getCompanyIdentifiers, isDerivedDefaultIdentifier, type CompanyIdentifier } from "./company-identifiers";
import { getPendingInboundMigration } from "./participant-migrations";
import { isRecommandSmpUrl } from "./phoss-smp/client";
import { lookUpSmpUrl, SmlLookupError } from "./recipient";

// Some countries give a company a default identifier built from its numbers, such as
// the Finnish OVT code or the German GEBA. Unlike the numbers themselves, that
// identifier is ours to add rather than something the customer asked for, so it must
// never be the reason a company cannot be registered: when it turns out to be
// published already, it is taken off the company and the registration goes ahead
// without it. The customer can still add it, with a migration key from the SMP that
// publishes it.

type DerivedIdentifierCompany = Pick<Company, "id" | "country" | "enterpriseNumber" | "vatNumber" | "smpProvider">;

/**
 * Whether the participant is published on the network by an SMP other than ours. Throws
 * SmlLookupError when the SML gives no answer, which says nothing either way.
 */
export async function isPublishedOnAnotherSmp(
  identifier: { scheme: string; identifier: string },
  useTestNetwork: boolean
): Promise<boolean> {
  const recipientAddress = `${identifier.scheme}:${identifier.identifier}`;
  const lookup = await lookUpSmpUrl({ recipientAddress, useTestNetwork });
  if (lookup.status === "unknown") {
    throw new SmlLookupError(recipientAddress);
  }
  return lookup.status === "found" && !isRecommandSmpUrl(lookup.smpUrl, useTestNetwork);
}

/** The identifiers the company holds that its country derives for it. */
export async function getHeldDerivedIdentifiers(company: DerivedIdentifierCompany): Promise<CompanyIdentifier[]> {
  if (derivedDefaultIdentifiers(company.country, company).length === 0) {
    return [];
  }
  return (await getCompanyIdentifiers(company.id)).filter((held) => isDerivedDefaultIdentifier(company, held.scheme, held.identifier));
}

/** Takes identifiers off the company in our records only; they were never registered for it. */
export async function removeDerivedIdentifiers(
  company: Pick<Company, "id">,
  identifiers: readonly CompanyIdentifier[],
  reason: string
): Promise<void> {
  if (identifiers.length === 0) {
    return;
  }
  await db.delete(companyIdentifiers).where(
    and(
      eq(companyIdentifiers.companyId, company.id),
      inArray(companyIdentifiers.id, identifiers.map((identifier) => identifier.id))
    )
  );
  for (const identifier of identifiers) {
    console.warn(`Removed derived identifier ${identifier.scheme}:${identifier.identifier} from company ${company.id} so it can be registered without it: ${reason}`);
  }
}

/**
 * Before a company is registered, takes off the derived identifiers that are already
 * published: by another recipient here, or by another SMP according to the SML. One
 * the customer stored a migration key for is left, since the registration claims it
 * with that key. Returns the identifiers it removed.
 */
export async function releaseDerivedIdentifiersPublishedElsewhere({
  company,
  useTestNetwork,
}: {
  company: DerivedIdentifierCompany;
  useTestNetwork: boolean;
}): Promise<CompanyIdentifier[]> {
  const released: CompanyIdentifier[] = [];
  for (const identifier of await getHeldDerivedIdentifiers(company)) {
    if (await getPendingInboundMigration({ companyId: company.id, scheme: identifier.scheme, identifier: identifier.identifier, useTestNetwork })) {
      continue;
    }
    if (!(await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, identifier.id, company.id))) {
      await removeDerivedIdentifiers(company, [identifier], "another recipient holds it");
      released.push(identifier);
      continue;
    }
    // Only our own SMP is told apart from the others here; the companies of the SMPs
    // we use for some countries get no derived identifiers.
    let elsewhere = false;
    try {
      elsewhere = company.smpProvider === "recommand-smp1" && (await isPublishedOnAnotherSmp(identifier, useTestNetwork));
    } catch (error) {
      // The lookup failing says nothing either way; the registration itself will tell.
      console.warn(`Could not look up ${identifier.scheme}:${identifier.identifier} in the SML: ${error}`);
    }
    if (elsewhere) {
      await removeDerivedIdentifiers(company, [identifier], "another SMP publishes it");
      released.push(identifier);
    }
  }
  return released;
}

/** The derived identifiers a failed registration names as the one it could not register. */
export async function derivedIdentifiersNamedBy(company: DerivedIdentifierCompany, error: unknown): Promise<CompanyIdentifier[]> {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (!message || derivedDefaultIdentifiers(company.country, company).length === 0) {
    return [];
  }
  return (await getHeldDerivedIdentifiers(company)).filter((identifier) =>
    message.includes(`${identifier.scheme}:${identifier.identifier}`.toLowerCase())
  );
}

/**
 * Registers the company on its SMP without letting a derived identifier hold it up:
 * the ones published elsewhere are taken off first, and one the SMP refuses is taken
 * off and the registration tried once more without it. `register` runs the
 * registration; `undoRegistration` rolls back what a refused attempt registered, and
 * is the caller's to make a no-op when nothing was registered yet.
 */
export async function registerReleasingDerivedIdentifiers({
  company,
  useTestNetwork,
  register,
  undoRegistration,
}: {
  company: DerivedIdentifierCompany;
  useTestNetwork: boolean;
  register: () => Promise<void>;
  undoRegistration: () => Promise<void>;
}): Promise<void> {
  await releaseDerivedIdentifiersPublishedElsewhere({ company, useTestNetwork });
  try {
    await register();
  } catch (error) {
    const refused = await derivedIdentifiersNamedBy(company, error);
    if (refused.length === 0) {
      throw error;
    }
    await undoRegistration();
    await removeDerivedIdentifiers(company, refused, error instanceof Error ? error.message : String(error));
    await register();
  }
}
