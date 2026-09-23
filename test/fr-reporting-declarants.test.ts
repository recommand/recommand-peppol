import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getFrenchSiren } from "../utils/identifier-validation";

const requests: { path: string; method: string; body: unknown }[] = [];
let respond: (path: string, method: string) => Response;

// The retry policy is pure; the database is never touched in this file.
mock.module("@recommand/db", () => ({ db: {} }));

mock.module("@peppol/data/at/client", () => ({
  getArratechConfig: () => ({ orgId: "org-1" }),
  fetchArratech: async (path: string, options: RequestInit) => {
    requests.push({
      path,
      method: options.method ?? "GET",
      body: typeof options.body === "string" ? JSON.parse(options.body) : null,
    });
    return respond(path, options.method ?? "GET");
  },
}));

const {
  ArratechDeclarantError,
  ARRATECH_DECLARANT_TAKEN,
  fetchArratechDeclarant,
  registerArratechDeclarant,
  removeArratechDeclarant,
} = await import("../data/at/fr-reporting-declarants");
const { nextRegistrationStateAfterFailure } = await import("../data/fr-reporting-declarants");

const registration = {
  orgId: "org-1",
  siren: "303265045",
  environment: "PROD",
  issuerName: "ACME SARL",
  vatRegime: "REEL_NORMAL_MENSUEL",
  vatExigibility: "DEBITS",
  enabled: true,
  intakeMode: "SELF_SUBMIT",
  createdAt: "2026-09-08T09:00:00Z",
  updatedAt: "2026-09-08T09:00:00Z",
  createdBy: "u1",
  updatedBy: "u1",
};

beforeEach(() => {
  requests.length = 0;
  respond = () => Response.json(registration);
});

describe("French SIREN derivation", () => {
  it("accepts a SIREN and derives it from a SIRET", () => {
    expect(getFrenchSiren("303265045")).toBe("303265045");
    expect(getFrenchSiren("303 265 045")).toBe("303265045");
    expect(getFrenchSiren("30326504500011")).toBe("303265045");
  });

  it("rejects numbers that are neither, or fail their check digit", () => {
    for (const value of [null, undefined, "", "12345678", "1234567890", "FR303265045", "303265046", "30326504500012"]) {
      expect(getFrenchSiren(value)).toBeNull();
    }
  });
});

describe("Arratech declarant client", () => {
  it("registers a declarant under the environment and SIREN of the URL", async () => {
    const declarant = await registerArratechDeclarant({
      environment: "PROD",
      siren: "303265045",
      input: { issuerName: "ACME SARL", vatRegime: "REEL_NORMAL_MENSUEL", vatExigibility: "DEBITS" },
      useTestNetwork: false,
    });

    expect(declarant.siren).toBe("303265045");
    expect(requests).toEqual([
      {
        path: "/orgs/org-1/tax-reporting/fr-f10/declarants/PROD/303265045",
        method: "PUT",
        body: {
          issuerName: "ACME SARL",
          vatRegime: "REEL_NORMAL_MENSUEL",
          vatExigibility: "DEBITS",
          enabled: true,
          intakeMode: "SELF_SUBMIT",
        },
      },
    ]);
  });

  it("surfaces the partner's code when the SIREN is held by another organisation", async () => {
    respond = () =>
      Response.json(
        { code: "AT-2704", error: "SIREN '303265045' is already registered as a declarant" },
        { status: 409 },
      );

    const error = await registerArratechDeclarant({
      environment: "PROD",
      siren: "303265045",
      input: { issuerName: "ACME SARL", vatRegime: "REEL_SIMPLIFIE", vatExigibility: "ENCAISSEMENTS" },
      useTestNetwork: false,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ArratechDeclarantError);
    expect(error.status).toBe(409);
    expect(error.code).toBe(ARRATECH_DECLARANT_TAKEN);
    expect(error.retryable).toBe(false);
  });

  it("marks provider unavailability as retryable", async () => {
    respond = () =>
      Response.json({ code: "AT-2708", error: "temporarily unavailable" }, { status: 503 });

    const error = await registerArratechDeclarant({
      environment: "PROD",
      siren: "303265045",
      input: { issuerName: "ACME SARL", vatRegime: "REEL_SIMPLIFIE", vatExigibility: "ENCAISSEMENTS" },
      useTestNetwork: false,
    }).catch((e) => e);

    expect(error.retryable).toBe(true);
    expect(error.code).toBe("AT-2708");
  });

  it("reads a missing registration as null and tolerates removing one that is gone", async () => {
    respond = () => Response.json({ code: "AT-2705", error: "not found" }, { status: 404 });

    expect(
      await fetchArratechDeclarant({ environment: "TEST", siren: "303265045", useTestNetwork: true }),
    ).toBeNull();
    await removeArratechDeclarant({ environment: "TEST", siren: "303265045", useTestNetwork: true });
    expect(requests.map((r) => r.method)).toEqual(["GET", "DELETE"]);
    expect(requests[0]!.path).toBe("/orgs/org-1/tax-reporting/fr-f10/declarants/TEST/303265045");
  });
});

describe("Registration retry policy", () => {
  const now = new Date("2026-09-08T10:00:00Z");

  it("retries retryable failures with a growing delay", () => {
    const error = new ArratechDeclarantError("down", 503, "AT-2708", true);
    const first = nextRegistrationStateAfterFailure({ attempts: 0 }, error, now);
    const later = nextRegistrationStateAfterFailure({ attempts: 5 }, error, now);

    expect(first.state).toBe("pending");
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt.getTime() - now.getTime()).toBe(2 * 60_000);
    expect(later.nextAttemptAt.getTime() - now.getTime()).toBe(60 * 60_000);
    expect(later.lastError).toBe("down");
  });

  it("blocks immediately on a refusal, a taken SIREN, or an unexpected error", () => {
    const refused = new ArratechDeclarantError("bad body", 400, "AT-2712", false);
    const taken = new ArratechDeclarantError("taken", 409, "AT-2704", false);

    expect(nextRegistrationStateAfterFailure({ attempts: 0 }, refused, now).state).toBe("blocked");
    expect(nextRegistrationStateAfterFailure({ attempts: 0 }, taken, now).state).toBe("blocked");
    expect(nextRegistrationStateAfterFailure({ attempts: 0 }, new Error("boom"), now).state).toBe("blocked");
  });

  it("gives up after a day of retries", () => {
    const error = new ArratechDeclarantError("down", 503, "AT-2708", true);
    expect(nextRegistrationStateAfterFailure({ attempts: 22 }, error, now).state).toBe("pending");
    expect(nextRegistrationStateAfterFailure({ attempts: 23 }, error, now).state).toBe("blocked");
  });
});
