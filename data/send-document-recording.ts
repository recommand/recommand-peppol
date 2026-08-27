import { createMiddleware } from "hono/factory";
import { ulid } from "ulid";

export const SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV =
  "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_BUCKET";
export const SEND_DOCUMENT_RECORDING_UPLOAD_TIMEOUT_MS = 30_000;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getRecordingsBucket(): string | null {
  return process.env[SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV]?.trim() || null;
}

function getRecordingS3Options() {
  return {
    accessKeyId: getRequiredEnv(
      "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_ACCESS_KEY_ID"
    ),
    secretAccessKey: getRequiredEnv(
      "PEPPOL_SEND_DOCUMENT_RECORDINGS_S3_SECRET_ACCESS_KEY"
    ),
    endpoint: getRequiredEnv("S3FS_ENDPOINT"),
    region: process.env.S3FS_REGION,
  };
}

/**
 * How a send was routed: the document type identifier it was transmitted under and the
 * process it travelled over, as the sending pipeline resolved them.
 *
 * Both are chosen from what the recipient is registered to receive when the request
 * leaves either of them open, so they are not derivable from the request alone — which
 * is why they are recorded rather than worked out again later. A replay that is handed
 * them sends the same document the recording did without having to look the recipient up
 * on a network that does not know it.
 */
export type SendDocumentRecordingRouting = {
  docTypeId: string;
  processId: string;
};

export type SendDocumentRecordingContext = {
  Variables: {
    team: { id: string };
    company: { id: string };
    sendDocumentRecordingXml: string | null;
    sendDocumentRecordingRouting: SendDocumentRecordingRouting | null;
  };
};

export type SendDocumentRecording = {
  id: string;
  capturedAt: string;
  teamId: string;
  companyId: string;
  requestPath: string;
  request: unknown;
  responseStatus: number;
  response: unknown;
  xmlDocument: string | null;
  /** Null for a send refused before a document was prepared. */
  docTypeId: string | null;
  processId: string | null;
};

export const SEND_DOCUMENT_RECORDINGS_S3_ROOT =
  "peppol-send-document-recordings";

export const captureSendDocumentRecording =
  createMiddleware<SendDocumentRecordingContext>(async (c, next) => {
    c.set("sendDocumentRecordingXml", null);
    c.set("sendDocumentRecordingRouting", null);

    if (!getRecordingsBucket()) {
      await next();
      return;
    }

    const request = structuredClone(await c.req.json());
    await next();

    const response = c.res.clone();
    const routing = c.get("sendDocumentRecordingRouting");
    const recording = {
      teamId: c.var.team.id,
      companyId: c.var.company.id,
      requestPath: c.req.path,
      request,
      responseStatus: c.res.status,
      xmlDocument: c.get("sendDocumentRecordingXml"),
      docTypeId: routing?.docTypeId ?? null,
      processId: routing?.processId ?? null,
    };

    void (async () => {
      await uploadSendDocumentRecording({
        ...recording,
        response: await response.json(),
      });
    })().catch((error) => {
      console.error("Failed to store send document recording:", error);
    });
  });

export async function uploadSendDocumentRecording(
  input: Omit<SendDocumentRecording, "id" | "capturedAt">
): Promise<string | null> {
  const bucket = getRecordingsBucket();
  if (!bucket) {
    return null;
  }

  const now = new Date();
  const id = "sdr_" + ulid();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const key = `${SEND_DOCUMENT_RECORDINGS_S3_ROOT}/${input.teamId}/${input.companyId}/${yyyy}/${mm}/${dd}/${id}.json`;
  const recording: SendDocumentRecording = {
    id,
    capturedAt: now.toISOString(),
    ...input,
  };

  const payload = JSON.stringify(recording, null, 2);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SEND_DOCUMENT_RECORDING_UPLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(`s3://${bucket}/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: controller.signal,
      s3: getRecordingS3Options(),
    });
    if (!response.ok) {
      throw new Error(`Recording upload failed with status ${response.status}`);
    }
    return key;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Recording upload timed out after ${SEND_DOCUMENT_RECORDING_UPLOAD_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
