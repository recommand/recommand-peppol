import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// The cache table is replaced by one row the tests control, and the CBE web
// service by a fetch that answers or fails.
const DAY_MS = 24 * 60 * 60 * 1000;
let cachedRow: Record<string, unknown> | null = null;
const cacheQuery: any = {
  from: () => cacheQuery,
  where: () => cacheQuery,
  orderBy: () => cacheQuery,
  limit: () => cacheQuery,
  then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(cachedRow ? [cachedRow] : []).then(resolve, reject),
};
const cacheWrite: any = { where: async () => {}, values: async () => {} };
mock.module("@recommand/db", () => ({
  db: {
    select: () => cacheQuery,
    transaction: async (run: (tx: unknown) => Promise<void>) => run({ delete: () => cacheWrite, insert: () => cacheWrite }),
  },
}));

const { getEnterpriseData } = await import("@peppol/data/cbe-public-search/client");
const { checkRepresentative, listRepresentatives } = await import("@peppol/data/representative-checks");

const originalFetch = globalThis.fetch;
const originalCredentials = { username: process.env.CBE_USERNAME, password: process.env.CBE_PASSWORD };
let cbeRequests = 0;

function cbeIsDown() {
  globalThis.fetch = (async () => {
    cbeRequests++;
    return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
  }) as unknown as typeof fetch;
}

function cbeListsManager(givenName: string, surname: string) {
  globalThis.fetch = (async () => {
    cbeRequests++;
    return new Response(`<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header><ReplyContext><AccountBalance>1000</AccountBalance></ReplyContext></soapenv:Header>
  <soapenv:Body>
    <ReadEnterpriseReply>
      <Enterprise>
        <Address>
          <Street><Description><Value>Wetstraat</Value></Description></Street>
          <HouseNumber>16</HouseNumber>
          <Zipcode>1000</Zipcode>
          <Municipality><Description><Value>Brussel</Value></Description></Municipality>
        </Address>
        <Function>
          <Code>10007</Code>
          <Description><Value>Bestuurder</Value></Description>
          <Period><Begin>2020-01-01</Begin></Period>
          <Person><GivenName>${givenName}</GivenName><Surname>${surname}</Surname></Person>
        </Function>
      </Enterprise>
    </ReadEnterpriseReply>
  </soapenv:Body>
</soapenv:Envelope>`);
  }) as unknown as typeof fetch;
}

function cacheHolds(representatives: { firstName: string; lastName: string }[], ageMs: number) {
  const updatedAt = new Date(Date.now() - ageMs);
  cachedRow = {
    enterpriseNumber: "0123456749",
    country: "BE",
    beginDate: null,
    street: "Wetstraat",
    number: "16",
    postalCode: "1000",
    city: "Brussel",
    juridicalFormCode: null,
    denominationCode: null,
    representatives: representatives.map((rep) => ({ ...rep, function: "Bestuurder", beginDate: "2020-01-01", endDate: null })),
    createdAt: updatedAt,
    updatedAt,
  };
}

const belgian = { id: "c1", teamId: "t1", name: "Example", country: "BE", enterpriseNumber: "BE0123456749" };
const name = (firstName: string, lastName: string) => ({ firstName, lastName });

beforeEach(() => {
  process.env.CBE_USERNAME = "user";
  process.env.CBE_PASSWORD = "password";
  cachedRow = null;
  cbeRequests = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.CBE_USERNAME = originalCredentials.username;
  process.env.CBE_PASSWORD = originalCredentials.password;
  if (originalCredentials.username === undefined) delete process.env.CBE_USERNAME;
  if (originalCredentials.password === undefined) delete process.env.CBE_PASSWORD;
});

describe("reading an enterprise through the CBE cache", () => {
  it("serves a copy younger than 30 days without asking the CBE", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 2 * DAY_MS);
    cbeIsDown();
    const data = await getEnterpriseData("0123456749", "BE");
    expect(data.representatives.map((rep) => rep.lastName)).toEqual(["Peeters"]);
    expect(cbeRequests).toBe(0);
  });

  it("asks the CBE when the copy is older than the caller accepts", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 2 * DAY_MS);
    cbeListsManager("Els", "Maes");
    const data = await getEnterpriseData("0123456749", "BE", { maxAgeMs: 60 * 60 * 1000 });
    expect(data.representatives.map((rep) => rep.lastName)).toEqual(["Maes"]);
    expect(cbeRequests).toBe(1);
  });

  it("falls back to a copy younger than 30 days when the CBE cannot be reached", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 2 * DAY_MS);
    cbeIsDown();
    const data = await getEnterpriseData("0123456749", "BE", { maxAgeMs: 60 * 60 * 1000 });
    expect(data.representatives.map((rep) => rep.lastName)).toEqual(["Peeters"]);
    expect(cbeRequests).toBe(1);
  });

  it("falls back when the CBE credentials are missing", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 2 * DAY_MS);
    delete process.env.CBE_USERNAME;
    const data = await getEnterpriseData("0123456749", "BE", { maxAgeMs: 60 * 60 * 1000 });
    expect(data.representatives.map((rep) => rep.lastName)).toEqual(["Peeters"]);
  });

  it("does not fall back to a copy older than 30 days", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 31 * DAY_MS);
    cbeIsDown();
    await expect(getEnterpriseData("0123456749", "BE", { maxAgeMs: 60 * 60 * 1000 })).rejects.toThrow("CBE API error");
    await expect(getEnterpriseData("0123456749", "BE")).rejects.toThrow("CBE API error");
  });
});

describe("the Belgian representative check while the CBE cannot be reached", () => {
  it("offers and accepts the representatives of a copy younger than 30 days", async () => {
    cacheHolds([{ firstName: "Jan", lastName: "Peeters" }], 2 * DAY_MS);
    cbeIsDown();
    expect(await listRepresentatives(belgian)).toEqual({
      representatives: [{ firstName: "Jan", lastName: "Peeters", function: "Bestuurder" }],
      nameWithoutList: "unknown",
    });
    expect(await checkRepresentative(belgian, name("Jan", "Peeters"))).toEqual(name("Jan", "Peeters"));
    await expect(checkRepresentative(belgian, name("Els", "Maes"))).rejects.toThrow("in the CBE registry");
  });

  it("refuses with an error the representative can act on when there is no copy to fall back to", async () => {
    cbeIsDown();
    const error = await checkRepresentative(belgian, name("Jan", "Peeters")).catch((caught) => caught);
    expect(error?.name).toBe("UserFacingError");
    expect(error?.message).toContain("try again later");
  });
});
