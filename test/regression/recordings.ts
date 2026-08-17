/**
 * Loading of send document recordings.
 *
 * Recordings are the JSON blobs the API writes to S3 for every send: the
 * request it received, the status and body it answered with, and the XML it
 * transmitted. Their shape and layout are written out here rather than
 * imported, so a change to the recorder that breaks this suite is a change
 * this suite is supposed to notice.
 *
 *   peppol-send-document-recordings/<teamId>/<companyId>/<yyyy>/<mm>/<dd>/<id>.json
 *
 * The key sorts chronologically (the date path first, then a ULID), so the
 * newest recordings are the last ones.
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
   * happened. Each one becomes a failing test of its own instead.
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

  return keys.sort();
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
  return files.sort();
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
 * How many objects are read at once, and how often a read is retried.
 *
 * A thousand recordings is a thousand GETs, and asking for them all at once
 * gets the connections closed underneath us: the run then dies before a single
 * test has run, because loading happens while the module is being evaluated.
 * A bucket is not the bottleneck here — the replays are — so the reads are
 * queued through a small pool, and the occasional dropped connection is
 * retried rather than being allowed to end the run.
 */
const CONCURRENCY = 16;
const ATTEMPTS = 3;

/**
 * Reads every key, at most `CONCURRENCY` at a time. `read` is a parameter so
 * this can be exercised without a bucket.
 */
export async function fetchRecordings(
  keys: string[],
  read: (key: string) => Promise<unknown>,
): Promise<LoadResult> {
  const loaded: (LoadedRecording | null)[] = new Array(keys.length).fill(null);
  const unreadable: { key: string; error: Error }[] = [];
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      const key = keys[index];
      if (key === undefined) return;
      try {
        loaded[index] = assertRecording(await withRetry(key, read), key);
      } catch (error) {
        unreadable.push({
          key,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker),
  );
  return {
    recordings: loaded.filter((entry) => entry !== null),
    unreadable,
  };
}

async function withRetry(
  key: string,
  read: (key: string) => Promise<unknown>,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read(key);
    } catch (error) {
      if (attempt === ATTEMPTS) {
        throw new Error(
          `Failed to read ${key} after ${ATTEMPTS} attempts. If it is a large ` +
            `recording the connection may be dropping mid-transfer; check the ` +
            `object's size before assuming the suite is at fault.`,
          { cause: error },
        );
      }
      await Bun.sleep(200 * attempt);
    }
  }
}

export function getRecordingSource(): RecordingSource {
  if (LOCAL_DIR) {
    return {
      description: `${LOCAL_DIR} (local directory)`,
      load: async () => {
        const files = listLocalFiles(LOCAL_DIR).slice(-LIMIT);
        return fetchRecordings(files, async (file) =>
          JSON.parse(readFileSync(file, "utf8")),
        );
      },
    };
  }

  return {
    description: `s3://${setting("bucket") || "<no bucket set>"}/${PREFIX}`,
    load: async () => {
      const client = s3Client();
      const keys = (await listKeys(client)).slice(-LIMIT);
      return fetchRecordings(keys, (key) => client.file(key).json());
    },
  };
}
