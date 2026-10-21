import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { validateXmlDocument } from "../data/validation/client";

// When the validation service fails, validateXmlDocument reports it through Telegram
// without waiting for the notification. Without TELEGRAM_CHAT_IDS that notification
// rejects, and an unhandled rejection stops a Bun server once the answer has been sent.
// Under bun test an unhandled rejection fails the running test, so each test below fails
// if the rejection is left unhandled.
//
// `fetch` plays the validation service and refuses anything else, so no test can reach
// Telegram or the real validator, and every request it receives is recorded.

const VALIDATOR_URL = "http://validator.test/validate";
const ENV_NAMES = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_IDS", "VALIDATION_SERVICE_URL"] as const;
const NOTIFICATION_FAILURE = "Failed to send Telegram notification:";

const failures = [
  {
    situation: "the validation service answers with an error status",
    logged: "Failed to validate XML document: 503",
    answer: async () => new Response("validation service unavailable", { status: 503 }),
  },
  {
    situation: "the validation service answers with an unexpected body",
    logged: "Failed to parse validation response",
    answer: async () => Response.json({ unexpected: true }),
  },
  {
    situation: "the validation service cannot be reached",
    logged: "Failed to validate XML document:",
    answer: async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    },
  },
];

let previousEnv: Record<string, string | undefined> = {};
let requests: string[] = [];
let answerValidation: () => Promise<Response>;
let errorMessages: unknown[] = [];
let notificationFailure: Promise<unknown>;
let consoleSpies: ReturnType<typeof spyOn>[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  // Bun and dotenv load the package's .env, so every variable is set or removed here
  // instead of relying on what the environment happens to hold.
  previousEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  delete process.env.TELEGRAM_CHAT_IDS;
  process.env.VALIDATION_SERVICE_URL = VALIDATOR_URL;

  requests = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === VALIDATOR_URL) {
      return answerValidation();
    }
    throw new Error(`Unexpected network call to ${new URL(url).host}`);
  }) as unknown as typeof fetch;

  // The notification is not awaited by validateXmlDocument; the test waits for the
  // failure to be logged instead, which is the last thing handling it does.
  errorMessages = [];
  let resolveNotificationFailure: (error: unknown) => void;
  notificationFailure = new Promise((resolve) => {
    resolveNotificationFailure = resolve;
  });
  consoleSpies = [
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "error").mockImplementation((message?: unknown, error?: unknown) => {
      errorMessages.push(message);
      if (message === NOTIFICATION_FAILURE) {
        resolveNotificationFailure(error);
      }
    }),
  ];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const spy of consoleSpies) {
    spy.mockRestore();
  }
  for (const name of ENV_NAMES) {
    const value = previousEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("validateXmlDocument when the validation service fails and TELEGRAM_CHAT_IDS is not set", () => {
  for (const { situation, logged, answer } of failures) {
    it(`returns an error result and handles the failed notification when ${situation}`, async () => {
      answerValidation = answer;

      const validation = await validateXmlDocument("<Invoice/>");

      expect(validation).toEqual({ result: "error", errors: [] });
      expect(String(errorMessages[0])).toStartWith(logged);

      const error = await notificationFailure;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("TELEGRAM_CHAT_IDS environment variable is not set");
      expect(requests).toEqual([VALIDATOR_URL]);
    });
  }
});
