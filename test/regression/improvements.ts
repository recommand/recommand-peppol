/**
 * Deliberate changes to what the API accepts.
 *
 * A recording is a snapshot of how the API behaved on the day it was made, not
 * a specification of how it should behave. So an improvement looks exactly like
 * a regression from here: the replay answers something the recording did not.
 * This is where such a change is written down — once, in the open, as part of
 * the commit that makes it — so that a run stays green without the comparison
 * being loosened for everything else.
 *
 * Two things keep an entry from turning into a blind spot:
 *
 * - It says what the replay is now expected to answer. A recording it covers is
 *   not exempt from the suite; it is held to the *new* behaviour instead, and
 *   anything else still fails.
 * - It only covers recordings made before `since`. Once the change is live,
 *   every new recording is compared strictly again, and once the oldest
 *   recording in the bucket is younger than `since` the entry is dead and can
 *   be deleted.
 *
 * Match on the kind of document or the kind of answer, never on a recording id:
 * one entry should cover every recording of its kind, including the ones made
 * between writing it and running the suite.
 */

import type { Recording } from "./recordings";

export type Improvement = {
  /** What changed and why, in the words you would use in a changelog. */
  reason: string;
  /**
   * The day the change reached production, `YYYY-MM-DD`. Recordings from that
   * day onwards are compared strictly.
   */
  since: string;
  /** Recognises a recording of the behaviour that was replaced. */
  matches: (recording: Recording) => boolean;
  /** What the replay is allowed to answer instead. */
  allows: (status: number, body: any) => boolean;
  /**
   * Rewrites the recorded XML into what the replay is now expected to
   * transmit. Absent for improvements that only changed the HTTP answer.
   * Anything the rewrite does not account for still fails the comparison.
   */
  rewriteXml?: (xml: string, recording: Recording) => string;
};

const PEPPOL_BIS3_PROFILE_ID =
  "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const FRANCE_BILLING_PROCESS_IDS = [
  "urn:peppol:france:billing:regulated",
  "urn:peppol:france:billing:non-regulated",
] as const;

function isFranceBillingProcessId(
  processId: unknown,
): processId is (typeof FRANCE_BILLING_PROCESS_IDS)[number] {
  return (
    typeof processId === "string" &&
    (FRANCE_BILLING_PROCESS_IDS as readonly string[]).includes(processId)
  );
}

export const IMPROVEMENTS: Improvement[] = [
  {
    reason:
      "NLCIUS (SI-UBL 2.0) documents are recognised now. Sending one as raw XML used to be refused because its format could not be detected.",
    since: "2026-08-20",
    matches: (recording) =>
      recording.responseStatus === 400 &&
      typeof recording.request?.document === "string" &&
      recording.request.document.includes("urn:fdc:nen.nl:nlcius:v1.0"),
    allows: (status) => status === 200,
  },
  {
    reason:
      "JSON invoices and credit notes sent with a French billing process now write that process into cbc:ProfileID. Production used to ignore processId in the generated UBL and always write the Peppol BIS Billing 3 profile.",
    since: "2026-10-01",
    matches: (recording) => {
      const documentType = recording.request?.documentType;
      if (documentType !== "invoice" && documentType !== "creditNote") {
        return false;
      }
      if (!isFranceBillingProcessId(recording.request?.processId)) {
        return false;
      }
      return (
        typeof recording.xmlDocument === "string" &&
        recording.xmlDocument.includes(
          `<cbc:ProfileID>${PEPPOL_BIS3_PROFILE_ID}</cbc:ProfileID>`,
        )
      );
    },
    allows: (status) => status === 200,
    rewriteXml: (xml, recording) =>
      xml.replaceAll(
        `<cbc:ProfileID>${PEPPOL_BIS3_PROFILE_ID}</cbc:ProfileID>`,
        `<cbc:ProfileID>${recording.request.processId}</cbc:ProfileID>`,
      ),
  },
];

/** The entry covering a recording, if the suite has been told about one. */
export function improvementFor(recording: Recording): Improvement | undefined {
  return IMPROVEMENTS.find(
    (improvement) =>
      recording.capturedAt < improvement.since && improvement.matches(recording),
  );
}
