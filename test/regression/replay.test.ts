/**
 * Regression suite: replays recorded production sends against the playground.
 *
 * For every send document recording in the bucket it sends the very same
 * request again and asserts that the API still answers with the same status
 * code, the same response body and the same transmitted XML. It is the
 * complement of the end-to-end suite: that one asserts a hand written matrix
 * of cases, this one asserts whatever real integrations actually send.
 *
 * See regression/README.md for configuration and for what is masked and why.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  COMPANY_ID,
  assertPlaygroundTeam,
  getDocumentXml,
  requireConfig,
  sendDocument,
  waitForApi,
} from "./helpers";
import { improvementFor } from "./improvements";
import {
  describeXmlDifference,
  isEmailOnlySend,
  missingSenderIdentifier,
  networkDecidedOutcome,
  normaliseResponseBody,
  normaliseXml,
  requestsEmail,
  rewriteRequest,
  senderIdentityRejection,
  xmlMasks,
} from "./normalise";
import { createProgress, red } from "./progress";
import {
  LIMIT,
  getRecordingSource,
  type LoadedRecording,
  type Recording,
} from "./recordings";
import { recordedDocumentVerdict } from "./validation";

const TIMEOUT = 120_000;

requireConfig();

const source = getRecordingSource();
console.log(`Loading recording files into RAM from ${source.description}...`);
const { recordings, unreadable } = await source.load();
console.log(
  `Replaying ${recordings.length} recording(s) from ${source.description}` +
    (LIMIT === Number.MAX_SAFE_INTEGER ? "" : ` (newest ${LIMIT})`) +
    (unreadable.length > 0
      ? `; ${unreadable.length} more could not be read, and are listed at the end`
      : ""),
);

const progress = createProgress(1 + recordings.length);

/**
 * Same as `test.concurrent`, but drives the status line and parks it before a
 * failure so bun's error is not overwritten. Replays are I/O-bound and
 * independent, so they overlap while waiting on the API. `--only-failures`
 * hides the per-test pass lines this replaces; `--max-concurrency` caps how
 * many run at once (see `test:regression` and the README).
 */
function replayTest(
  name: string,
  fn: () => void | Promise<void>,
  timeout?: number,
): void {
  const wrapped = async () => {
    progress.begin(name);
    try {
      await fn();
      progress.pass(name);
    } catch (error) {
      progress.fail(name);
      throw error;
    }
  };
  if (timeout === undefined) test.concurrent(name, wrapped);
  else test.concurrent(name, wrapped, timeout);
}

/**
 * What was asserted less strictly than the rest, counted and reported at the
 * end so that a run which quietly compared very little cannot look like a
 * thorough one.
 */
const networkDecided: string[] = [];
const validatorRefused: string[] = [];
const emailNotSent: string[] = [];
const emailOnly: string[] = [];
const senderIdentity: string[] = [];
const senderUnregistered: string[] = [];
const improved: string[] = [];
const rejected: string[] = [];
const xmlCompared: string[] = [];
const xmlNotCompared: string[] = [];

/**
 * The same route, aimed at the playground company. Only the company id in the
 * path is swapped, so a recording of `/api/v1/:id/send` still exercises the
 * `/api/v1` alias rather than being quietly rerouted.
 */
function replayPath(recording: Recording): string {
  const path = recording.requestPath.replace(
    `/${recording.companyId}/`,
    `/${COMPANY_ID}/`,
  );
  if (path.includes(`/${COMPANY_ID}/`)) return path;
  return `/api/peppol/${COMPANY_ID}/send`;
}

/**
 * A test is named after the object it replays, in full. `bun test -t` matches
 * on the name, so a failure can be re-run by pasting it, and it says outright
 * which object to fetch from the bucket to see what went in.
 */
function label({ key, recording }: LoadedRecording): string {
  const type = recording.request?.documentType ?? "unknown";
  return `${key} (${type} → ${recording.responseStatus})`;
}

/**
 * A status on its own says a replay was refused; only the body says why. It is
 * the first thing anyone looks up after a status mismatch, and it is the one
 * thing not in the bucket, so failures carry it.
 */
function describeAnswer(status: number, body: any, limit = 1500): string {
  const rendered = JSON.stringify(body, null, 2) ?? String(body);
  return rendered.length > limit
    ? `${status}: ${rendered.slice(0, limit)}\n  … (${rendered.length - limit} more characters)`
    : `${status}: ${rendered}`;
}

describe("send document recordings", () => {
  beforeAll(async () => {
    progress.begin("waiting for API");
    await waitForApi();
    progress.begin("checking playground team");
    await assertPlaygroundTeam();
  }, 180_000);

  afterAll(() => {
    progress.finish();
    const notes = [
      xmlCompared.length > 0 &&
        `${xmlCompared.length} had the XML they transmitted compared in full`,
      networkDecided.length > 0 &&
        `${networkDecided.length} ended the way the network answered rather than the way the API decided, ` +
          `so their status and body were not compared — their XML still was`,
      emailNotSent.length > 0 &&
        `${emailNotSent.length} asked for the document to be mailed, which the replay does not do — the mail was ` +
          `taken out of the request, and what became of it out of the comparison`,
      emailOnly.length > 0 &&
        `${emailOnly.length} delivered by mail only, so there was no send left to replay once the mail was ` +
          `taken out, and they were not replayed at all`,
      validatorRefused.length > 0 &&
        `${validatorRefused.length} were refused by validation rules that the document the recording itself ` +
          `transmitted is refused by too, so what changed is the verdict on that document rather than the ` +
          `document the API builds`,
      senderIdentity.length > 0 &&
        `${senderIdentity.length} were refused because the playground company's VAT identity differs from the ` +
          `recorded sender's, which is the sender changing rather than the API`,
      senderUnregistered.length > 0 &&
        `${senderUnregistered.length} were refused in production because the company that sent them has no company ` +
          `identifier, which the playground company does have, so the recorded refusal is the sending company's ` +
          `configuration rather than the API`,
      improved.length > 0 &&
        `${improved.length} predate a change listed in improvements.ts, so they were held to the new behaviour ` +
          `rather than to the recorded one`,
      rejected.length > 0 &&
        `${rejected.length} were rejected, so their status was compared but their body was not`,
      xmlNotCompared.length > 0 &&
        `${xmlNotCompared.length} stored no document on replay, so their XML was not compared`,
    ].filter(Boolean);

    if (notes.length > 0) {
      console.log(
        `\nOf ${recordings.length} recording(s):\n  ${notes.join("\n  ")}`,
      );
    }

    // Not failures: an object that will not come out of the bucket says
    // nothing about the API, and a run that found a regression should not have
    // that finding sitting among a dozen storage errors. It is not silence
    // either — the run says which objects it never saw, in red, once
    // everything else has been reported.
    if (unreadable.length === 0) return;
    console.log(
      red(
        `\n${unreadable.length} recording(s) could not be read from ${source.description} ` +
          `and were not replayed:\n` +
          unreadable
            .map(({ key, error }) => `  ${key}\n    ${error.message}`)
            .join("\n"),
      ),
    );
  });

  replayTest("there are recordings to replay", () => {
    if (recordings.length === 0) {
      throw new Error(
        `No recordings found in ${source.description}. Widen REGRESSION_RECORDING_PREFIX.`,
      );
    }
  });

  for (const loaded of recordings) {
    const { recording } = loaded;
    replayTest(
      label(loaded),
      async () => {
        // The mail is taken out of the request rather than aimed somewhere
        // harmless, so nothing is sent and nobody is billed for it. A send
        // that was only ever a mail is left alone entirely: without `email.to`
        // the API refuses it before it does anything, so replaying it would
        // assert a refusal the suite itself caused.
        if (isEmailOnlySend(recording.request)) {
          emailOnly.push(label(loaded));
          return;
        }
        const emailWasNotSent = requestsEmail(recording.request);
        if (emailWasNotSent) emailNotSent.push(label(loaded));

        const replay = await sendDocument(
          replayPath(recording),
          rewriteRequest(recording.request),
        );

        // Delivery is the one thing the playground cannot reproduce: the
        // simulator answers where the receiving access point did. When either
        // side's outcome was settled by that answer, the status and the body
        // describe the network and not the API, so all that is asserted is
        // that the request still got as far as being handed to it. The XML
        // below is the part that stays meaningful, and it is where a
        // regression in one of these sends would show up anyway.
        const decidedByNetwork =
          networkDecidedOutcome(recording.responseStatus, recording.response) ||
          networkDecidedOutcome(replay.status, replay.body);

        // A recording of behaviour we have since changed on purpose. The
        // recorded answer is out of date, so the replay is held to what
        // improvements.ts says the new answer is instead.
        const improvement = improvementFor(recording);

        if (improvement) {
          improved.push(label(loaded));
          if (!improvement.allows(replay.status, replay.body)) {
            throw new Error(
              `The replay answered ${replay.status}, which the improvement covering this recording does not allow:\n` +
                `  ${improvement.reason}\n` +
                `Either that improvement regressed, or its entry in improvements.ts needs updating.`,
            );
          }
        } else if (decidedByNetwork) {
          networkDecided.push(label(loaded));
          if (replay.status !== 200 && replay.status !== 422) {
            // A send only left the building because nothing called its
            // document invalid, which is not the same as it having been held
            // against the rules: see validation.ts.
            const verdict = await recordedDocumentVerdict(recording, replay);
            if (verdict?.explained) {
              validatorRefused.push(label(loaded));
            } else {
              throw new Error(
                `The network settled how this send ended, so the replay was only expected to reach the network at all ` +
                  `(200 or 422). It answered:\n  ${describeAnswer(replay.status, replay.body)}` +
                  (verdict ? `\n  ${verdict.description}` : ""),
              );
            }
          }
        } else if (
          recording.responseStatus < 400 &&
          senderIdentityRejection(recording.request, replay.status, replay.body)
        ) {
          // The document differs from the recorded one only in the seller the
          // API filled in, and that difference is what the validator refused.
          senderIdentity.push(label(loaded));
        } else if (
          missingSenderIdentifier(
            recording.responseStatus,
            recording.response,
          ) &&
          replay.status !== recording.responseStatus
        ) {
          // Production refused this one before it read the document, because
          // the company sending it had no identifier. The playground company
          // has one, so the replay gets further — and there is nothing to hold
          // it to, since the recording never exercised the rest of the send.
          senderUnregistered.push(label(loaded));
          if (replay.status >= 400) {
            throw new Error(
              `This recording was refused in production because the sending company has no company identifier, ` +
                `which the playground company does have, so the replay was only expected to get past that check. ` +
                `It was refused for a different reason:\n  ${describeAnswer(replay.status, replay.body)}`,
            );
          }
        } else if (replay.status !== recording.responseStatus) {
          // Same question as above: a document refused by rules the recording's
          // own document is refused by is a verdict that moved, not a document
          // that changed.
          const verdict = await recordedDocumentVerdict(recording, replay);
          if (verdict?.explained) {
            validatorRefused.push(label(loaded));
          } else {
            throw new Error(
              `The API answered ${replay.status} where the recording has ${recording.responseStatus}.\n` +
                `  replay:   ${describeAnswer(replay.status, replay.body)}\n` +
                `  recorded: ${describeAnswer(recording.responseStatus, recording.response)}` +
                (verdict ? `\n  ${verdict.description}` : ""),
            );
          }
        } else {
          // A rejection is asserted by its status code alone. Which requests
          // the API refuses is the contract; the wording it refuses them with
          // is not, and it gets improved from time to time. Only a send that
          // succeeded has a body worth comparing field by field.
          if (recording.responseStatus < 400) {
            expect(
              normaliseResponseBody(replay.body, { emailWasNotSent }),
            ).toEqual(
              normaliseResponseBody(recording.response, { emailWasNotSent }),
            );
          } else {
            rejected.push(label(loaded));
          }
        }

        // Only a send that stored a document has XML to compare, on either
        // side: a recording whose XML was never captured has nothing to
        // assert, and a replay that was rejected stores nothing to assert it
        // against.
        if (recording.xmlDocument === null) return;
        if (!replay.body?.id) {
          xmlNotCompared.push(label(loaded));
          return;
        }

        const actualXml = await getDocumentXml(replay.body.id);
        if (actualXml === null) {
          throw new Error(
            `The replayed document ${replay.body.id} has no XML, but the recording transmitted ${recording.xmlDocument.length} characters of it.`,
          );
        }

        const masks = xmlMasks(recording.request);
        const expectedXml = normaliseXml(recording.xmlDocument, masks)!;
        const replayedXml = normaliseXml(actualXml, masks)!;
        if (expectedXml !== replayedXml) {
          throw new Error(
            `The transmitted XML changed:\n${describeXmlDifference(expectedXml, replayedXml)}`,
          );
        }
        xmlCompared.push(label(loaded));
      },
      TIMEOUT,
    );
  }
});
