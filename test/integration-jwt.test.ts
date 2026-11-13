import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { calculateJwkThumbprint, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import jwks from "../api/integrations/jwks";
import type { ActivatedIntegration } from "../data/integrations";
import { generateIntegrationJwt, verifyIntegrationJwt } from "../data/integrations/auth";

const integration = {
  companyId: "company",
  id: "integration",
  manifest: { url: "https://integration.example.com" },
  teamId: "team",
} as ActivatedIntegration;

const SETTINGS = ["INTEGRATIONS_JWKS", "INTEGRATIONS_PRIVATE_KEY", "SIGNING_KEYS"] as const;
const previous = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));

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
  // The key set from `SIGNING_KEYS` would take the place of the keys this test sets
  delete process.env.SIGNING_KEYS;
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const { publicKey } = keys;
  const { e, kty, n } = await exportJWK(publicKey);
  publicJwk = { e, kty, n };
  process.env.INTEGRATIONS_PRIVATE_KEY = await exportPKCS8(privateKey);
  process.env.INTEGRATIONS_JWKS = JSON.stringify({ keys: [{ alg: "RS256", e, kty, n, use: "sig" }] });
  kid = await calculateJwkThumbprint({ e, kty, n });
});

afterAll(() => {
  SETTINGS.forEach((name) => {
    if (previous[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous[name];
    }
  });
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
