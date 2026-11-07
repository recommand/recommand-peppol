import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sendSystemAlert, sendTelegramNotification } from "../utils/system-notifications/telegram";

// Alerts go to Telegram, outside our infrastructure: email addresses are masked, and
// an alert longer than Telegram accepts is truncated instead of rejected.

const realFetch = globalThis.fetch;
const previousChatIds = process.env.TELEGRAM_CHAT_IDS;
const previousBotToken = process.env.TELEGRAM_BOT_TOKEN;
let sentTexts: string[] = [];
let sentParseModes: (string | undefined)[] = [];
let consoleSpies: ReturnType<typeof spyOn>[] = [];

beforeEach(() => {
  process.env.TELEGRAM_CHAT_IDS = "1";
  process.env.TELEGRAM_BOT_TOKEN = "token";
  sentTexts = [];
  sentParseModes = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    sentTexts.push(body.text);
    sentParseModes.push(body.parse_mode);
    return Response.json({ ok: true, result: { message_id: 1, date: 0, text: "" } });
  }) as unknown as typeof fetch;
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
  for (const [name, value] of [["TELEGRAM_CHAT_IDS", previousChatIds], ["TELEGRAM_BOT_TOKEN", previousBotToken]] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("system alert content", () => {
  it("masks email addresses in a system alert to their first character and domain", async () => {
    await sendSystemAlert("Notification Address Unreachable", "The mail service no longer accepts mail for jan.peeters@acme.be.");

    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).not.toContain("jan.peeters");
    expect(sentTexts[0]).toContain("j\\*\\*\\*@acme\\.be");
  });

  it("masks email addresses in a plain notification", async () => {
    await sendTelegramNotification("Payment failed: Found inactive addresses: billing.team@example.co.uk");

    expect(sentTexts).toEqual(["Payment failed: Found inactive addresses: b***@example.co.uk"]);
  });

  // Escaped dots are two characters each; two lengths put the cut on both halves of one.
  for (const prefixLength of [4000, 4001]) {
    it(`truncates a system alert to the length Telegram accepts, without a dangling escape (${prefixLength})`, async () => {
      await sendSystemAlert("Document Sending Failed", "x".repeat(prefixLength) + ".".repeat(500), "error");

      const text = sentTexts[0];
      expect(text.length).toBeLessThanOrEqual(4096);
      expect(text.endsWith("… \\(truncated\\)")).toBe(true);
      expect(text.slice(0, -"\n\n… \\(truncated\\)".length)).not.toMatch(/(^|[^\\])(\\\\)*\\$/);
    });
  }

  it("truncates a plain notification to the length Telegram accepts", async () => {
    await sendTelegramNotification("y".repeat(5000));

    expect(sentTexts[0].length).toBe(4096);
    expect(sentTexts[0].endsWith("… (truncated)")).toBe(true);
  });

  it("sends a plain notification as plain text, so markup characters in an error cannot get it refused", async () => {
    await sendTelegramNotification("Error billing team team_1: Error: expected <Invoice> & got none");

    expect(sentTexts).toEqual(["Error billing team team_1: Error: expected <Invoice> & got none"]);
    expect(sentParseModes).toEqual([undefined]);
  });

  it("keeps sending system alerts as MarkdownV2", async () => {
    await sendSystemAlert("Title", "Message");

    expect(sentParseModes).toEqual(["MarkdownV2"]);
  });

  it("leaves a short alert as it is", async () => {
    await sendTelegramNotification("Billing event bev_1 for team team_1 is still unfinished");

    expect(sentTexts).toEqual(["Billing event bev_1 for team team_1 is still unfinished"]);
  });
});
