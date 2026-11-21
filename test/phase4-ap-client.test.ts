import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { sendAs4 } from "../data/phase4-ap/client";

// What the Recommand access point's answer says about whether a failed send may have
// gone out, which decides whether it can be retried.

const fetchMock = spyOn(globalThis, "fetch");

afterAll(() => {
  fetchMock.mockRestore();
});

const send = () =>
  sendAs4({
    body: "<Invoice/>",
    countryC1: "BE",
    docTypeId: "doc-type",
    processId: "process",
    receiverId: "0208:0428643097",
    senderId: "0208:0123456749",
    useTestNetwork: true,
  });

const answer = (response: Response) => {
  fetchMock.mockImplementation((async () => response) as unknown as typeof fetch);
};

describe("sendAs4", () => {
  it("reports a send that went out", async () => {
    answer(Response.json({ as4MessageId: "msg-1", overallSuccess: true }));
    const result = await send();
    expect(result.ok).toBe(true);
    expect(result.outcomeUnknown).toBeUndefined();
  });

  it("leaves a failed send it answered unknown, since it may have timed out after delivery", async () => {
    answer(Response.json({ overallSuccess: false, sendingException: { message: "Read timed out" } }));
    const result = await send();
    expect(result.ok).toBe(false);
    expect(result.outcomeUnknown).toBe(true);
  });

  it("reports a request the access point refused as refused", async () => {
    answer(new Response("Bad request", { status: 400 }));
    expect((await send()).outcomeUnknown).toBeUndefined();
    answer(new Response("Too many requests", { status: 429 }));
    expect((await send()).outcomeUnknown).toBeUndefined();
  });

  it("leaves a timeout or a server error unknown", async () => {
    answer(new Response("Timeout", { status: 408 }));
    expect((await send()).outcomeUnknown).toBe(true);
    answer(new Response("Unavailable", { status: 503 }));
    expect((await send()).outcomeUnknown).toBe(true);
  });

  it("leaves any other 4xx unknown, since it may have come after the access point took the document", async () => {
    answer(new Response("Conflict", { status: 409 }));
    expect((await send()).outcomeUnknown).toBe(true);
  });

  it("leaves a lost connection unknown", async () => {
    fetchMock.mockImplementation((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    expect((await send()).outcomeUnknown).toBe(true);
  });
});
