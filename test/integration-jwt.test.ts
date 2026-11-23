import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { calculateJwkThumbprint, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from "jose";
import jwks from "../api/integrations/jwks";
import type { ActivatedIntegration } from "../data/integrations";
import { generateIntegrationJwt, verifyIntegrationJwt } from "../data/integrations/auth";

const integration = {
  companyId: "company",
  id: "integration",
  manifest: { url: "https://integration.example.com" },
  teamId: "team",
} as ActivatedIntegration;

const previous = process.env.SIGNING_KEYS;

let kid: string;
let privateKey: CryptoKey;
let publicJwk: { e?: string; kty?: string; n?: string };

const otherToken = async (header: { kid?: string; typ?: string }, issuer = "https://app.recommand.eu") =>
  new SignJWT({ companyId: "company", integrationId: "integration", teamId: "team" })
    .setProtectedHeader({ alg: "RS256", ...header })
    .setAudience("https://app.recommand.eu")
    .setIssuer(issuer)
    .setExpirationTime("5m")
    .sign(privateKey);

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const { publicKey } = keys;
  const { e, kty, n } = await exportJWK(publicKey);
  publicJwk = { e, kty, n };
  process.env.SIGNING_KEYS = JSON.stringify({ keys: [await exportJWK(privateKey)] });
  kid = await calculateJwkThumbprint({ e, kty, n });
});

afterAll(() => {
  if (previous === undefined) {
    delete process.env.SIGNING_KEYS;
  } else {
    process.env.SIGNING_KEYS = previous;
  }
});

describe("integration tokens", () => {
  test("name the key that signed them, and verify", async () => {
    const jwt = await generateIntegrationJwt(integration);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "RS256", kid });
    expect(await verifyIntegrationJwt(jwt)).toMatchObject({ companyId: "company", integrationId: "integration", teamId: "team" });
  });

  test("don't include other tokens signed with the same keys", async () => {
    expect(await verifyIntegrationJwt(await otherToken({ kid, typ: "at+jwt" }))).toBeNull();
  });

  test("need the platform as their issuer", async () => {
    expect(await verifyIntegrationJwt(await otherToken({ kid }, "https://elsewhere.example.com"))).toBeNull();
  });

  test("still verify without a `kid`, as they were signed before, while one key is published", async () => {
    expect(await verifyIntegrationJwt(await otherToken({}))).toMatchObject({ integrationId: "integration" });
  });

  test("are verified by the published key set", async () => {
    const response = await jwks.request("/integrations/jwks");
    expect(response.status).toBe(200);
    const { keys } = await response.json();
    expect(keys).toEqual([{ ...publicJwk, alg: "RS256", kid, use: "sig" }]);
  });
});
