import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElmaClient, ElmaApiError, type ElmaProcess } from "@peppol/data/elma/client";
import { mapDocumentTypesToElmaProcesses } from "@peppol/data/elma/processes";
import { COUNTRIES } from "@peppol/utils/countries";
import { getReceivingCapability } from "@peppol/utils/type-repository/receiving-capabilities";

// The adapter is tested through an injected fetch; the database is never reached.
mock.module("@recommand/db", () => ({ db: {} }));
const { contactFor, publishParticipant } = await import("@peppol/data/elma/smp");

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "elma", name), "utf8"));

const catalogue: ElmaProcess[] = [
  ...fixture("processes-page-0.json").content,
  ...fixture("processes-page-1.json").content,
];

const BILLING_UBL = "8c6b15f6-6845-46b1-9ff1-92e226d7670a";
const SELF_BILLING = "2d3c3cad-9cf6-46dc-b4dd-513e19e9282f";
const MLR = "b583f6ea-deb2-4e38-b4de-a737eb19381f";
const INVOICE_RESPONSE = "f9eed7f0-c342-411d-a704-e52285b2ed25";
const BILLING = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

describe("mapping document types to ELMA processes", () => {
  it("maps the default Norwegian document types to the Peppol BIS Billing UBL process", () => {
    const norway = COUNTRIES.find((country) => country.code === "NO")!;
    expect(mapDocumentTypesToElmaProcesses(norway.defaultDocumentTypes, catalogue)).toEqual([BILLING_UBL]);
  });

  it("maps every capability ELMA offers to exactly one process", () => {
    const documentTypes = [
      getReceivingCapability("peppol-ubl-bis3-invoice", BILLING),
      getReceivingCapability("peppol-ubl-bis3-creditnote", BILLING),
      getReceivingCapability("peppol-ubl-selfbilling-invoice", "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0"),
      getReceivingCapability("peppol-ubl-selfbilling-creditnote", "urn:fdc:peppol.eu:2017:poacc:selfbilling:01:1.0"),
      getReceivingCapability("peppol-ubl-mlr", "urn:fdc:peppol.eu:poacc:bis:mlr:3"),
      getReceivingCapability("peppol-ubl-invoice-response", "urn:fdc:peppol.eu:poacc:bis:invoice_response:3"),
    ];
    expect(mapDocumentTypesToElmaProcesses(documentTypes, catalogue)).toEqual([BILLING_UBL, SELF_BILLING, MLR, INVOICE_RESPONSE]);
  });

  it("refuses a document type no ELMA process carries", () => {
    const xrechnung = getReceivingCapability("xrechnung-ubl-invoice", BILLING);
    expect(() => mapDocumentTypesToElmaProcesses([xrechnung], catalogue)).toThrow(
      "ELMA, the Norwegian receiver register, does not offer this document type for registration"
    );
  });

  it("ignores deprecated processes", () => {
    const pilot = catalogue.find((process) => process.restricted)!;
    const documentType = {
      processId: String(pilot.qualifiedIdentifier).split("::").slice(1).join("::"),
      docTypeId: String(pilot.documentTypes![0].qualifiedIdentifier).split("::").slice(1).join("::"),
    };
    expect(() => mapDocumentTypesToElmaProcesses([documentType], catalogue)).toThrow("does not offer");
  });

  it("takes the process meant for the ICD when ELMA lists the same process twice", () => {
    // ELMA test lists Peppol BIS Billing UBL once for 0192 and once for 0007 and 0192.
    const billing = catalogue.find((process) => process.identifier === BILLING_UBL)!;
    const wider = { ...billing, identifier: "00000000-0000-0000-0000-000000000000", requiredICDs: ["0007", "0192"] };
    const invoice = getReceivingCapability("peppol-ubl-bis3-invoice", BILLING);
    expect(mapDocumentTypesToElmaProcesses([invoice], [wider, ...catalogue])).toEqual([BILLING_UBL]);
  });

  it("refuses a document type that different processes carry rather than guess the role", () => {
    const billing = catalogue.find((process) => process.identifier === BILLING_UBL)!;
    const otherDomain = { ...billing, identifier: "00000000-0000-0000-0000-000000000000", domain: "Logistics" };
    expect(() =>
      mapDocumentTypesToElmaProcesses([getReceivingCapability("peppol-ubl-bis3-invoice", BILLING)], [...catalogue, otherDomain])
    ).toThrow("does not offer");
  });

  it("ignores a process the participant's ICD cannot be registered for", () => {
    const billing = catalogue.find((process) => process.identifier === BILLING_UBL)!;
    const otherIcd = { ...billing, requiredICDs: ["0007"] };
    expect(() =>
      mapDocumentTypesToElmaProcesses([getReceivingCapability("peppol-ubl-bis3-invoice", BILLING)], [otherIcd])
    ).toThrow("does not offer");
  });

  it("reads identifiers served as {scheme, value} objects as well as strings", () => {
    const billing = catalogue.find((process) => process.identifier === BILLING_UBL)!;
    const documented: ElmaProcess = {
      ...billing,
      qualifiedIdentifier: { scheme: "cenbii-procid-ubl", value: BILLING },
      documentTypes: billing.documentTypes!.map((documentType) => {
        const [scheme, ...value] = String(documentType.qualifiedIdentifier).split("::");
        return { ...documentType, qualifiedIdentifier: { scheme, value: value.join("::") } };
      }),
    };
    expect(mapDocumentTypesToElmaProcesses([getReceivingCapability("peppol-ubl-bis3-invoice", BILLING)], [documented])).toEqual([BILLING_UBL]);
  });
});

type Call = { method: string; path: string; body?: unknown; authorization?: string | null };

/** A fake ELMA that answers by "METHOD path" and records every call. */
function fakeElma(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: `${url.pathname.replace(/^\/rest/, "")}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("Authorization"),
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    return route ? route(call) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  const client = createElmaClient(
    { apiUrl: "https://elma.example/rest", username: "sp-user", password: "secret", serviceProviderId: "sp-recommand" },
    fetchImpl
  );
  return { client, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const PARTICIPANT = "/api/participants/iso6523-actorid-upis%3A%3A0192%3A923609016";

describe("the ELMA client", () => {
  it("authenticates with HTTP Basic as the service provider", async () => {
    const { client, calls } = fakeElma({ [`GET ${PARTICIPANT}`]: () => json(fixture("participant-ours.json")) });
    await client.getParticipant("0192", "923609016");
    expect(calls[0].authorization).toBe(`Basic ${Buffer.from("sp-user:secret").toString("base64")}`);
  });

  it("reads every page of the process catalogue", async () => {
    const { client, calls } = fakeElma({
      "GET /api/processes?size=200&page=0": () => json(fixture("processes-page-0.json")),
      "GET /api/processes?size=200&page=1": () => json(fixture("processes-page-1.json")),
    });
    expect(await client.listProcesses()).toHaveLength(catalogue.length);
    expect(calls.map((call) => call.path)).toEqual(["/api/processes?size=200&page=0", "/api/processes?size=200&page=1"]);
  });

  it("reports an unknown participant as null and a failed delete of one as false", async () => {
    const { client } = fakeElma({});
    expect(await client.getParticipant("0192", "923609016")).toBeNull();
    expect(await client.deleteParticipant("0192", "923609016")).toBe(false);
  });

  it("raises ELMA's answer on any other failure", async () => {
    const { client } = fakeElma({ [`GET ${PARTICIPANT}`]: () => new Response("boom", { status: 500 }) });
    const error = await client.getParticipant("0192", "923609016").catch((caught) => caught);
    expect(error).toBeInstanceOf(ElmaApiError);
    expect(error.status).toBe(500);
  });
});

describe("publishing a participant in ELMA", () => {
  const form = { processes: [{ identifier: BILLING_UBL }], contact: { name: "NORDLYS HANDEL AS", email: "post@nordlys.example" } };
  const publish = (client: ReturnType<typeof fakeElma>["client"]) =>
    publishParticipant({ client, organisationNumber: "923609016", name: "NORDLYS HANDEL AS", form });

  it("adds a participant ELMA does not know, with the fields AddParticipantFormDTO requires", async () => {
    const { client, calls } = fakeElma({ "POST /api/participants": () => json(fixture("participant-ours.json"), 201) });
    expect(await publish(client)).toBe("added");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${PARTICIPANT}`, "POST /api/participants"]);
    expect(calls[1].body).toEqual({ icd: "0192", organizationIdentifier: "923609016", name: "NORDLYS HANDEL AS", ...form });
  });

  it("updates our own participant with the processes and contact UpdateParticipantFormDTO requires", async () => {
    const { client, calls } = fakeElma({
      [`GET ${PARTICIPANT}`]: () => json(fixture("participant-ours.json")),
      [`PUT ${PARTICIPANT}`]: () => json(fixture("participant-ours.json")),
    });
    expect(await publish(client)).toBe("updated");
    expect(calls[1]).toMatchObject({ method: "PUT", path: PARTICIPANT, body: form });
  });

  it("takes over a participant of another service provider with ELMA's transfer", async () => {
    const { client, calls } = fakeElma({
      [`GET ${PARTICIPANT}`]: () => json(fixture("participant-other-provider.json")),
      [`PUT ${PARTICIPANT}/transfer/sp-recommand`]: () => new Response(null, { status: 200 }),
      [`PUT ${PARTICIPANT}`]: () => json(fixture("participant-ours.json")),
    });
    expect(await publish(client)).toBe("transferred");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${PARTICIPANT}`,
      `PUT ${PARTICIPANT}/transfer/sp-recommand`,
      `PUT ${PARTICIPANT}`,
    ]);
  });

  it("updates a participant ELMA serves without a provider, as it does in practice", async () => {
    const { client, calls } = fakeElma({
      [`GET ${PARTICIPANT}`]: () => json(fixture("participant-as-served.json")),
      [`PUT ${PARTICIPANT}`]: () => json(fixture("participant-as-served.json")),
    });
    expect(await publish(client)).toBe("updated");
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  });

  it("transfers when ELMA refuses to update a participant it serves without a provider", async () => {
    const { client, calls } = fakeElma({
      [`GET ${PARTICIPANT}`]: () => json(fixture("participant-as-served.json")),
      [`PUT ${PARTICIPANT}`]: (() => {
        let attempts = 0;
        return () => (++attempts === 1 ? new Response("Forbidden", { status: 403 }) : json(fixture("participant-as-served.json")));
      })(),
      [`PUT ${PARTICIPANT}/transfer/sp-recommand`]: () => new Response(null, { status: 200 }),
    });
    expect(await publish(client)).toBe("transferred");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${PARTICIPANT}`,
      `PUT ${PARTICIPANT}`,
      `PUT ${PARTICIPANT}/transfer/sp-recommand`,
      `PUT ${PARTICIPANT}`,
    ]);
  });

  it("transfers when ELMA only reveals the other registration on add", async () => {
    const { client, calls } = fakeElma({
      "POST /api/participants": () => new Response("Participant already exists", { status: 409 }),
      [`PUT ${PARTICIPANT}/transfer/sp-recommand`]: () => new Response(null, { status: 200 }),
      [`PUT ${PARTICIPANT}`]: () => json(fixture("participant-ours.json")),
    });
    expect(await publish(client)).toBe("transferred");
    expect(calls).toHaveLength(4);
  });

  it("explains a refused transfer and names the current provider", async () => {
    const { client } = fakeElma({
      [`GET ${PARTICIPANT}`]: () => json(fixture("participant-other-provider.json")),
      [`PUT ${PARTICIPANT}/transfer/sp-recommand`]: () => new Response("Forbidden", { status: 403 }),
    });
    await expect(publish(client)).rejects.toThrow(
      "0192:923609016 is already registered in ELMA, the Norwegian receiver register, by another service provider (Other Provider AS)"
    );
  });

  it("does not take over on an unrelated add failure", async () => {
    const { client, calls } = fakeElma({ "POST /api/participants": () => new Response("Invalid ICD", { status: 400 }) });
    await expect(publish(client)).rejects.toBeInstanceOf(ElmaApiError);
    expect(calls.some((call) => call.path.includes("/transfer/"))).toBe(false);
  });
});

describe("the contact ELMA keeps", () => {
  it("is the company, with email and phone when it has them", () => {
    expect(contactFor({ name: "Nordlys Handel AS", email: null, phone: null })).toEqual({ name: "Nordlys Handel AS" });
    expect(contactFor({ name: "Nordlys Handel AS", email: "post@nordlys.example", phone: "+47 22 00 00 00" })).toEqual({
      name: "Nordlys Handel AS",
      email: "post@nordlys.example",
      phoneNumber: "+47 22 00 00 00",
    });
  });
});
