import { UserFacingError } from "@peppol/utils/util";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import {
  BronnoysundUnavailableError,
  lookupOrganisation,
  type BronnoysundClientOptions,
  type OrganisationLookup,
} from "./client";

export const NORWEGIAN_ORGANISATION_SCHEME = "0192";

type Identifier = { scheme: string; identifier: string };

export type OrganisationCheckDependencies = BronnoysundClientOptions & {
  alert?: typeof sendSystemAlert;
};

/**
 * Refuses to register a Norwegian organisation number (0192) as a Peppol receiver
 * unless Enhetsregisteret knows it and has not deleted it. The Norwegian Peppol
 * Authority requires this of every SMP that hosts Norwegian participants, whichever
 * SMP that is. Identifiers under other schemes pass untouched.
 *
 * When the register cannot be reached even after retries, the registration goes
 * ahead: an outage at the register must not block receiving. Support is alerted
 * with the numbers that were registered unchecked, so they can be looked up by hand.
 */
export async function assertNorwegianOrganisationsRegistrable(
  identifiers: readonly Identifier[],
  dependencies: OrganisationCheckDependencies = {}
): Promise<void> {
  const alert = dependencies.alert ?? sendSystemAlert;
  const numbers = [
    ...new Set(
      identifiers
        .filter((identifier) => identifier.scheme === NORWEGIAN_ORGANISATION_SCHEME)
        .map((identifier) => identifier.identifier)
    ),
  ];
  const unchecked: string[] = [];

  for (const number of numbers) {
    let lookup: OrganisationLookup;
    try {
      lookup = await lookupOrganisation(number, dependencies);
    } catch (error) {
      if (error instanceof BronnoysundUnavailableError) {
        unchecked.push(number);
        continue;
      }
      throw error;
    }
    if (lookup.status === "notFound") {
      throw new UserFacingError(
        `Organisation number ${number} is not registered in Enhetsregisteret, the Norwegian register of legal entities, so it cannot be registered as a Peppol receiver. Check the number, or contact support@recommand.eu if it is correct.`
      );
    }
    if (lookup.status === "deleted") {
      throw new UserFacingError(
        `Organisation number ${number} was deleted from Enhetsregisteret, the Norwegian register of legal entities${lookup.deletedOn ? `, on ${lookup.deletedOn}` : ""}, so it cannot be registered as a Peppol receiver.`
      );
    }
  }

  if (unchecked.length > 0) {
    await alert(
      "Norwegian Organisation Registered Unchecked",
      `Enhetsregisteret could not be reached, so ${unchecked.map((number) => `0192:${number}`).join(", ")} was registered without checking that the organisation exists. Look the number up at https://data.brreg.no/enhetsregisteret/api/enheter/ and deregister it if the organisation does not exist.`,
      "warning"
    );
  }
}
