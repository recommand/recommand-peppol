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
};

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
];

/** The entry covering a recording, if the suite has been told about one. */
export function improvementFor(recording: Recording): Improvement | undefined {
  return IMPROVEMENTS.find(
    (improvement) =>
      recording.capturedAt < improvement.since && improvement.matches(recording),
  );
}
