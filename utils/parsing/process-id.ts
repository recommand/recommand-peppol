import { PROCESS_SCHEME } from "@peppol/data/phoss-smp/service-metadata";

export function normalizeProcessId(processId: string): string {
  const prefix = `${PROCESS_SCHEME}::`;
  return processId.startsWith(prefix)
    ? processId.slice(prefix.length)
    : processId;
}
