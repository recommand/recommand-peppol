import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { validateXmlDocument } from "../data/validation/client";
import { sendSystemAlert, sendTelegramNotification } from "../utils/system-notifications/telegram";

// Without Telegram recipients, an alert must not reject: validateXmlDocument does not
// await it, and an unhandled rejection stops a Bun server. Bun test fails a test that
// leaves one unhandled.

const realFetch = globalThis.fetch;
const previousChatIds = process.env.TELEGRAM_CHAT_IDS;
let consoleSpies: ReturnType<typeof spyOn>[] = [];

beforeEach(() => {
  delete process.env.TELEGRAM_CHAT_IDS;
  consoleSpies = [
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "error").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const spy of consoleSpies) {
    spy.mockRestore();
  }
  if (previousChatIds === undefined) {
    delete process.env.TELEGRAM_CHAT_IDS;
  } else {
    process.env.TELEGRAM_CHAT_IDS = previousChatIds;
  }
});

describe("system alerts without Telegram recipients", () => {
  it("resolves instead of rejecting", async () => {
    await expect(sendSystemAlert("Title", "Message", "error")).resolves.toBeUndefined();
  });

  it("reports the missing recipients in the notification result instead of rejecting", async () => {
    await expect(sendTelegramNotification("Message")).resolves.toEqual({
      success: false,
      sentTo: [],
      errors: ["TELEGRAM_CHAT_IDS environment variable is not set"],
    });
  });

  const failures: [string, () => Promise<Response>][] = [
    ["answers with an error status", async () => new Response("unavailable", { status: 503 })],
    ["answers with an unexpected body", async () => Response.json({ unexpected: true })],
    ["cannot be reached", async () => { throw new TypeError("fetch failed"); }],
  ];

  for (const [situation, answer] of failures) {
    it(`lets validation return an error result when the validation service ${situation}`, async () => {
      globalThis.fetch = answer as unknown as typeof fetch;

      expect(await validateXmlDocument("<Invoice/>")).toEqual({ result: "error", errors: [] });
      // The alert is not awaited; give it a turn so a rejection would surface in this test.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
});
