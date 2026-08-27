/**
 * Loading of send document recordings.
 *
 * Recordings are the JSON blobs the API writes to S3 for every send: the
 * request it received, the status and body it answered with, the XML it
 * transmitted, and the document type identifier and the process it transmitted
 * it under. Their shape and layout are written out here rather than imported,
 * so a change to the recorder that breaks this suite is a change this suite is
 * supposed to notice.
 *
 *   peppol-send-document-recordings/<teamId>/<companyId>/<yyyy>/<mm>/<dd>/<id>.json
 *
 * The team and the company come first, so a key does not sort chronologically
 * on its own; only its tail does. See `recordedAt`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { S3Client } from "bun";

export const RECORDINGS_ROOT = "peppol-send-document-recordings";

export type Recording = {
  id: string;
  capturedAt: string;
  teamId: string;
  companyId: string;
  requestPath: string;
  request: any;
  responseStatus: number;
  response: any;
  xmlDocument: string | null;
  /**
   * How the send was routed: the document type identifier it was transmitted
   * under and the process it travelled over. Absent on a send that was refused
   * before a document was prepared, and on any recording made before the
   * recorder wrote them down — the replay then routes the document itself,
   * which is what this suite always did. See `withRecordedRouting` in
   * `normalise.ts`.
   */
  docTypeId?: string | null;
  processId?: string | null;
};

/**
 * A recording together with where it was read from: its full key in the
 * bucket, or its path on disk. Tests are named after it, so a failure says
 * which object to fetch and re-run rather than only which id it had.
 */
export type LoadedRecording = {
  key: string;
  recording: Recording;
};

export type LoadResult = {
  recordings: LoadedRecording[];
  /**
   * Objects that could not be read at all. They are carried out of here rather
   * than thrown: loading runs while the module is being evaluated, so one
   * unreadable object thrown from here ends the run before a single replay has
   * happened. They are not failures either — an object that will not come out
   * of the bucket says nothing about the API — so the run replays everything
   * else and lists them, in red, when it is done.
   */
  unreadable: { key: string; error: Error }[];
};

export type RecordingSource = {
  /** Human readable description of where the recordings came from. */
  description: string;
  load: () => Promise<LoadResult>;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** How many of the newest recordings are replayed. `0` means all of them. */
const rawLimit = process.env.REGRESSION_RECORDING_LIMIT?.trim();
export const LIMIT =
  rawLimit === "0" ? Number.MAX_SAFE_INTEGER : positiveInt(rawLimit, 1000);

/**
 * Narrows the listing. Because the key spells out the team, the company and
 * then the date, a prefix selects any of those: one team, one company, one
 * company on one day. See the README.
 */
const PREFIX = process.env.REGRESSION_RECORDING_PREFIX?.trim() || RECORDINGS_ROOT;

/** A directory of recording JSON files, used instead of S3 when set. */
const LOCAL_DIR = process.env.REGRESSION_RECORDING_DIR?.trim() || "";

/**
 * Where the recordings are read from, and with which credentials.
 *
 * Each setting falls back to the variable the recorder itself writes with, so
 * an environment that already holds the production values needs no
 * configuration of its own. The `REGRESSION_RECORDING_S3_*` override in front
 * of it is what lets a run read from somewhere else — a copy of the bucket, a
 * read only key, another account — without touching the variables the
 * application uses to record.
 */
const S3_SETTINGS = {
  bucket: [
    "REGRESSION_RECORDING_S3_BUCKET",
    "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_BUCKET",
  ],
  accessKeyId: [
    "REGRESSION_RECORDING_S3_ACCESS_KEY_ID",
    "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_ACCESS_KEY_ID",
  ],
  secretAccessKey: [
    "REGRESSION_RECORDING_S3_SECRET_ACCESS_KEY",
    "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_SECRET_ACCESS_KEY",
  ],
  endpoint: ["REGRESSION_RECORDING_S3_ENDPOINT", "S3FS_ENDPOINT"],
  region: ["REGRESSION_RECORDING_S3_REGION", "S3FS_REGION"],
} as const;

type S3Setting = keyof typeof S3_SETTINGS;

/** An empty value counts as unset, so an override left blank falls through. */
function setting(name: S3Setting): string {
  const [override, fallback] = S3_SETTINGS[name];
  return process.env[override]?.trim() || process.env[fallback]?.trim() || "";
}

function requiredSetting(name: S3Setting): string {
  const value = setting(name);
  if (!value) {
    const [override, fallback] = S3_SETTINGS[name];
    throw new Error(
      `Neither ${override} nor ${fallback} is set. Set one of them, ` +
        `or point REGRESSION_RECORDING_DIR at a directory of recordings. See test/regression/README.md.`,
    );
  }
  return value;
}

function s3Client(): S3Client {
  return new S3Client({
    bucket: requiredSetting("bucket"),
    accessKeyId: requiredSetting("accessKeyId"),
    secretAccessKey: requiredSetting("secretAccessKey"),
    endpoint: requiredSetting("endpoint"),
    region: setting("region") || undefined,
  });
}

async function listKeys(client: S3Client): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.list({
      prefix: PREFIX,
      maxKeys: 1000,
      continuationToken,
    });
    for (const entry of page.contents ?? []) {
      if (entry.key.endsWith(".json")) keys.push(entry.key);
    }
    continuationToken = page.isTruncated
      ? (page.nextContinuationToken ?? undefined)
      : undefined;
  } while (continuationToken);

  return keys.sort(byRecordedAt);
}

/**
 * The chronological part of a key: `<yyyy>/<mm>/<dd>/<id>.json`.
 *
 * The team and the company come before the date in the path, so sorting keys
 * as they stand orders by team first and `LIMIT` would take the alphabetically
 * last teams rather than the newest sends — a bounded run would then replay
 * one corner of the bucket while reporting that it replayed the newest N. The
 * date path is zero padded and the id is a ULID, so the tail on its own does
 * sort chronologically.
 */
function recordedAt(key: string): string {
  return key.split("/").slice(-4).join("/");
}

/**
 * Oldest first, so the newest recordings are the last ones. Exported for the
 * same reason `fetchRecordings` is: it decides what a bounded run replays, so
 * it is worth pinning without a bucket.
 */
export function byRecordedAt(a: string, b: string): number {
  const left = recordedAt(a);
  const right = recordedAt(b);
  if (left !== right) return left < right ? -1 : 1;
  // Two sends can share a ULID only if the same recording is listed twice, but
  // the order still has to be total for a run to be reproducible.
  return a < b ? -1 : a > b ? 1 : 0;
}

function listLocalFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".json")) {
        files.push(full);
      }
    }
  };
  walk(dir);
  return files.sort(byRecordedAt);
}

function isRecording(value: any): value is Recording {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.requestPath === "string" &&
    typeof value.responseStatus === "number" &&
    "request" in value
  );
}

function assertRecording(value: any, key: string): LoadedRecording {
  if (!isRecording(value)) {
    throw new Error(`${key} is not a send document recording`);
  }
  return { key, recording: value };
}

/**
 * How many objects are read at once, how often a read is retried, and what
 * becomes of the ones that still will not read.
 *
 * A thousand recordings is a thousand GETs, and asking for them all at once
 * gets the connections closed underneath us: the run then dies before a single
 * test has run, because loading happens while the module is being evaluated.
 * A bucket is not the bottleneck here — the replays are — so the reads are
 * queued through a small pool, and the occasional dropped connection is
 * retried rather than being allowed to end the run.
 *
 * Those drops are load induced, though, so retrying a fifth of a second later
 * while fifteen other reads are still in flight retries under the very
 * conditions that caused them — which is why a large recording that drops
 * mid-transfer tends to drop on all three attempts and be reported as
 * unreadable when nothing is wrong with it. Whatever the pool could not read
 * is therefore read again once the pool has drained, on its own and one object
 * at a time, before it is called unreadable.
 */
const CONCURRENCY = 16;
const ATTEMPTS = 3;
const ATTEMPT_PAUSE_MS = 200;
const SOLO_ATTEMPTS = 3;
const SOLO_ATTEMPT_PAUSE_MS = 1_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Reads every key, at most `CONCURRENCY` at a time, then reads what failed
 * again on its own. `read` and `size` are parameters so this can be exercised
 * without a bucket; `size` is only ever consulted for an object that is about
 * to be reported as unreadable, and is allowed to fail.
 */
export async function fetchRecordings(
  keys: string[],
  read: (key: string) => Promise<unknown>,
  size?: (key: string) => Promise<number | null>,
): Promise<LoadResult> {
  const loaded: (LoadedRecording | null)[] = new Array(keys.length).fill(null);
  // Kept with the position the key had, so that both the recordings and the
  // failures come out in the order they were listed in however the reads
  // interleaved, and a run stays reproducible.
  const unreadable: { index: number; key: string; error: Error }[] = [];
  const dropped: { index: number; key: string; error: Error }[] = [];
  let next = 0;

  // A recording that reads but is not shaped like one is not going to be
  // shaped like one on a second read, and a recorder change makes that true of
  // every object at once — so only a failed *read* is worth repeating.
  const store = (index: number, key: string, value: unknown): void => {
    try {
      loaded[index] = assertRecording(value, key);
    } catch (error) {
      unreadable.push({ index, key, error: asError(error) });
    }
  };

  const worker = async () => {
    while (true) {
      const index = next++;
      const key = keys[index];
      if (key === undefined) return;
      try {
        store(
          index,
          key,
          await withRetry(key, read, ATTEMPTS, ATTEMPT_PAUSE_MS),
        );
      } catch (error) {
        dropped.push({ index, key, error: asError(error) });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker),
  );

  // The second pass: one object at a time, with nothing else in flight.
  for (const { index, key } of dropped.sort((a, b) => a.index - b.index)) {
    try {
      store(
        index,
        key,
        await withRetry(key, read, SOLO_ATTEMPTS, SOLO_ATTEMPT_PAUSE_MS),
      );
    } catch (error) {
      unreadable.push({
        index,
        key,
        error: await describeUnreadable(key, asError(error), size),
      });
    }
  }

  return {
    recordings: loaded.filter((entry) => entry !== null),
    unreadable: unreadable
      .sort((a, b) => a.index - b.index)
      .map(({ key, error }) => ({ key, error })),
  };
}

async function withRetry(
  key: string,
  read: (key: string) => Promise<unknown>,
  attempts: number,
  pauseMs: number,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read(key);
    } catch (error) {
      if (attempt === attempts) throw asError(error);
      await Bun.sleep(pauseMs * attempt);
    }
  }
}

function describeSize(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * The error the failing test carries. The first thing to establish about an
 * object that will not read is whether there is anything left in it to read,
 * which is what its size says, so the message answers that question rather
 * than asking the reader to go and look it up. A size that comes back while
 * every read closes the socket means the metadata survived the body.
 */
async function describeUnreadable(
  key: string,
  error: Error,
  size?: (key: string) => Promise<number | null>,
): Promise<Error> {
  const bytes = size ? await size(key).catch(() => null) : null;
  return new Error(
    `Failed to read ${key}: ${ATTEMPTS} attempts alongside the other reads and ` +
      `${SOLO_ATTEMPTS} more on its own all ended in "${error.message}". ` +
      (bytes === null
        ? `Its size could not be read either, so start with whether it is still there at all.`
        : `The object is ${describeSize(bytes)}. A size that answers while every read of the ` +
          `body closes the socket means the metadata outlived the body, and there is nothing ` +
          `left in it to replay.`),
    { cause: error },
  );
}

export function getRecordingSource(): RecordingSource {
  if (LOCAL_DIR) {
    return {
      description: `${LOCAL_DIR} (local directory)`,
      load: async () => {
        const files = listLocalFiles(LOCAL_DIR).slice(-LIMIT);
        return fetchRecordings(
          files,
          async (file) => JSON.parse(readFileSync(file, "utf8")),
          async (file) => statSync(file).size,
        );
      },
    };
  }

  return {
    description: `s3://${setting("bucket") || "<no bucket set>"}/${PREFIX}`,
    load: async () => {
      const client = s3Client();
      const keys = (await listKeys(client)).slice(-LIMIT);
      return fetchRecordings(
        keys,
        (key) => client.file(key).json(),
        // Metadata only: it answers for an object whose body no longer reads,
        // which is the difference the failing test is there to report.
        async (key) => (await client.stat(key)).size,
      );
    },
  };
}
