import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zodValidator } from "@recommand/lib/zod-validator";
import {
  captureSendDocumentRecording,
  SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV,
} from "../data/send-document-recording";
import { sendDocumentSchema } from "../utils/parsing/send-document";

describe("recording a send whose body is not JSON", () => {
  let bucket: string | undefined;
  beforeEach(() => {
    bucket = process.env[SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV];
    process.env[SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV] = "recordings";
  });
  afterEach(() => {
    if (bucket === undefined) delete process.env[SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV];
    else process.env[SEND_DOCUMENT_RECORDINGS_S3_BUCKET_ENV] = bucket;
  });

  function app() {
    const hono = new Hono();
    hono.post(
      "/send",
      captureSendDocumentRecording,
      zodValidator("json", sendDocumentSchema),
      (c) => c.json({ sent: true }),
    );
    hono.onError((err, c) =>
      err instanceof HTTPException
        ? c.json({ refusedBy: "validator", message: err.message }, err.status)
        : c.json({ refusedBy: "crash", message: err.message }, 500),
    );
    return hono;
  }

  // A PHP client whose json_encode() fails on text that is not UTF-8 posts an empty body.
  it.each(["", "{\"documentType\":"])("leaves the body %j to the validator", async (body) => {
    const response = await app().request("/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      refusedBy: "validator",
      message: "Malformed JSON in request body",
    });
  });
});
