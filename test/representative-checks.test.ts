import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BronnoysundUnavailableError } from "@peppol/data/bronnoysund/client";
import {
  assessSigningAuthority,
  fetchSigningAuthority,
  parseSigningAuthorityRecord,
  type SigningAuthority,
} from "@peppol/data/bronnoysund/signing-authority";

// The checks are tested through their dependencies; the database is never reached.
mock.module("@recommand/db", () => ({ db: {} }));
const { checkRepresentative } = await import("@peppol/data/representative-checks");
type Dependencies = NonNullable<Parameters<typeof checkRepresentative>[2]>;

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "bronnoysund", name), "utf8"));

const authority = (signature: string, procuration: string): SigningAuthority => ({
  signature: parseSigningAuthorityRecord(fixture(signature)),
  procuration: parseSigningAuthorityRecord(fixture(procuration)),
});

const soleOrBoard = authority("signatur-sole-and-joint.json", "prokura-sole.json");
const name = (firstName: string, lastName: string) => ({ firstName, lastName });

describe("reading signing authority from Enhetsregisteret", () => {
  it("reads both the signature and the procuration lookup", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      return new Response(
        JSON.stringify(fixture(url.pathname.endsWith("/signatur") ? "signatur-sole-and-joint.json" : "prokura-sole.json"))
      );
    }) as typeof fetch;

    const result = await fetchSigningAuthority("923609016", { fetch: fetchImpl });

    expect(requests.sort()).toEqual(["/fullmakt/enheter/923609016/prokura", "/fullmakt/enheter/923609016/signatur"]);
    expect(result).toEqual(soleOrBoard);
    expect(result.signature?.combinations.map((combination) => combination.code)).toEqual(["R0002", "STYR"]);
  });
});

describe("assessing who may act for a Norwegian organisation", () => {
  it("lets the daglig leder sign alone under 'daglig leder alene'", () => {
    expect(assessSigningAuthority(soleOrBoard, name("Ingrid", "Berg"))).toEqual({
      kind: "sole", authority: "signature", role: "DAGL", rule: "Daglig leder alene",
    });
  });

  it("lets a procuration holder act alone", () => {
    expect(assessSigningAuthority(soleOrBoard, name("Per", "Lie"))).toMatchObject({ kind: "sole", authority: "procuration" });
  });

  it("finds that a board member may only sign together with the board", () => {
    expect(assessSigningAuthority(soleOrBoard, name("Kari", "Nordmann"))).toEqual({
      kind: "joint", authority: "signature", rule: "Styret i fellesskap",
    });
  });

  it("matches a name given without its middle name", () => {
    expect(assessSigningAuthority(soleOrBoard, name("Ola", "Hansen")).kind).toBe("joint");
  });

  it("finds no authority for someone the register does not list", () => {
    expect(assessSigningAuthority(soleOrBoard, name("Nils", "Dahl"))).toEqual({ kind: "none" });
  });

  it("cannot decide for someone in a possible role when the register could not interpret the rules", () => {
    const uninterpreted = authority("signatur-uninterpreted.json", "prokura-not-available.json");
    expect(assessSigningAuthority(uninterpreted, name("Ingrid", "Berg")).kind).toBe("undetermined");
    expect(assessSigningAuthority(uninterpreted, name("Nils", "Dahl")).kind).toBe("none");
  });

  it("cannot decide when the register returns no one", () => {
    const unavailable = authority("signatur-not-available.json", "prokura-not-available.json");
    expect(assessSigningAuthority(unavailable, name("Ingrid", "Berg")).kind).toBe("undetermined");
  });

  it("treats a joint rule with a single person as that person acting alone", () => {
    const singleBoard: SigningAuthority = {
      signature: {
        routineStatus: "OK",
        possibleSignatories: [],
        combinations: [{ code: "STYR", description: "Styret i fellesskap", persons: [{ name: "Kari Nordmann", role: "LEDE" }] }],
      },
      procuration: null,
    };
    expect(assessSigningAuthority(singleBoard, name("Kari", "Nordmann")).kind).toBe("sole");
  });
});

describe("checking the representative of a Norwegian company", () => {
  const company = { id: "c_no", name: "Nordlys Handel AS", country: "NO", enterpriseNumber: "923609016" };

  function dependencies(signingAuthority: SigningAuthority | Error) {
    const alerts: string[] = [];
    const lookups: string[] = [];
    const deps: Dependencies = {
      getEnterpriseData: async () => { throw new Error("must not be called"); },
      fetchSigningAuthority: async (organisationNumber) => {
        lookups.push(organisationNumber);
        if (signingAuthority instanceof Error) throw signingAuthority;
        return signingAuthority;
      },
      alert: async (title, message) => { alerts.push(`${title}: ${message}`); },
    };
    return { deps, alerts, lookups };
  }

  it("accepts someone who may sign alone", async () => {
    const { deps, alerts, lookups } = dependencies(soleOrBoard);
    expect(await checkRepresentative(company, name("Ingrid", "Berg"), deps)).toEqual(name("Ingrid", "Berg"));
    expect(lookups).toEqual(["923609016"]);
    expect(alerts).toEqual([]);
  });

  it("sends someone who may only sign jointly to manual review", async () => {
    const { deps, alerts } = dependencies(soleOrBoard);
    await expect(checkRepresentative(company, name("Kari", "Nordmann"), deps)).rejects.toThrow(
      "We could not confirm automatically that you may sign for this company on your own."
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("They may only sign jointly with others (Styret i fellesskap).");
  });

  it("sends an undetermined case to manual review", async () => {
    const { deps, alerts } = dependencies(authority("signatur-not-available.json", "prokura-not-available.json"));
    await expect(checkRepresentative(company, name("Ingrid", "Berg"), deps)).rejects.toThrow("contact support@recommand.eu");
    expect(alerts[0]).toContain("could not be confirmed");
  });

  it("refuses someone who cannot sign", async () => {
    const { deps, alerts } = dependencies(soleOrBoard);
    await expect(checkRepresentative(company, name("Nils", "Dahl"), deps)).rejects.toThrow(
      "does not match anyone who can sign for this company or holds procuration in Enhetsregisteret"
    );
    expect(alerts).toEqual([]);
  });

  it("asks to try again when the register is unreachable", async () => {
    const { deps } = dependencies(new BronnoysundUnavailableError("down"));
    await expect(checkRepresentative(company, name("Ingrid", "Berg"), deps)).rejects.toThrow("Please try again in a few minutes.");
  });

  it("refuses a company without an organisation number", async () => {
    const { deps } = dependencies(soleOrBoard);
    await expect(checkRepresentative({ ...company, enterpriseNumber: null }, name("Ingrid", "Berg"), deps)).rejects.toThrow(
      "Company does not have an enterprise number."
    );
  });
});

describe("the representative check per country", () => {
  const belgian = { id: "c_be", name: "Acme BV", country: "BE", enterpriseNumber: "BE0123456749" };

  function belgianDependencies(representatives: { firstName?: string; lastName?: string }[]) {
    const lookups: string[] = [];
    const deps = {
      getEnterpriseData: async (enterpriseNumber: string) => {
        lookups.push(enterpriseNumber);
        return { representatives } as any;
      },
      fetchSigningAuthority: async () => { throw new Error("must not be called"); },
      alert: async () => {},
    } satisfies Dependencies;
    return { deps, lookups };
  }

  it("holds a Belgian representative against the CBE without the country prefix", async () => {
    const { deps, lookups } = belgianDependencies([{ firstName: "Jan", lastName: "Peeters" }]);
    expect(await checkRepresentative(belgian, name("Jan", "Peeters"), deps)).toEqual(name("Jan", "Peeters"));
    expect(lookups).toEqual(["0123456749"]);
    await expect(checkRepresentative(belgian, name("Els", "Maes"), deps)).rejects.toThrow("in the CBE registry");
  });

  it("lets a Belgian company without named representatives through on an unknown name", async () => {
    const { deps } = belgianDependencies([{ firstName: "Jan" }]);
    expect(await checkRepresentative(belgian, name("Els", "Maes"), deps)).toEqual(name("UNKNOWN", "UNKNOWN"));
  });

  it("checks nothing for a country without a register check", async () => {
    const { deps } = belgianDependencies([]);
    deps.getEnterpriseData = async () => { throw new Error("must not be called"); };
    const dutch = { ...belgian, country: "NL", enterpriseNumber: "12345678" };
    expect(await checkRepresentative(dutch, name("Els", "Maes"), deps)).toEqual(name("Els", "Maes"));
  });
});
