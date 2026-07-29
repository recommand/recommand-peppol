import { resolveFrenchProcessId } from "./france";

/**
 * Selects the process id for countries where the document, rather than its document
 * type, decides which of several processes it travels over.
 *
 * Returns undefined when the resolver has no say over this document: either it is not
 * governed by that country, or the document leaves the choice open. Returning a process
 * id means the resolver is claiming the document, so it must always be a real one.
 */
export type CountrySpecificProcessResolver = (
  processId: string,
  document: unknown
) => string | undefined;

const COUNTRY_SPECIFIC_PROCESS_RESOLVERS: CountrySpecificProcessResolver[] = [
  resolveFrenchProcessId,
];

/**
 * Returns the process id the document's country selects, or the process id the document
 * type declared when no country claims it.
 */
export function resolveCountrySpecificProcessId(
  processId: string,
  document: unknown
): string {
  for (const resolve of COUNTRY_SPECIFIC_PROCESS_RESOLVERS) {
    const countrySpecificProcessId = resolve(processId, document);
    if (countrySpecificProcessId) {
      return countrySpecificProcessId;
    }
  }
  return processId;
}
