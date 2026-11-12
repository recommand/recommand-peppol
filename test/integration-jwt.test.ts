import { beforeAll, describe, expect, test } from "bun:test";
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

let kid: string;
let privateKey: CryptoKey;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const { publicKey } = keys;
  const { e, kty, n } = await exportJWK(publicKey);
  process.env.INTEGRATIONS_PRIVATE_KEY = await exportPKCS8(privateKey);
  process.env.INTEGRATIONS_JWKS = JSON.stringify({ keys: [{ alg: "RS256", e, kty, n, use: "sig" }] });
  kid = await calculateJwkThumbprint({ e, kty, n });
});

describe("integration tokens", () => {
  test("name the key that signed them, and verify", async () => {
    const jwt = await generateIntegrationJwt(integration);
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "RS256", kid });
    expect(await verifyIntegrationJwt(jwt)).toMatchObject({ companyId: "company", integrationId: "integration", teamId: "team" });
  });

  test("don't include other tokens signed with the same keys", async () => {
    const other = await new SignJWT({ companyId: "company", integrationId: "integration", teamId: "team" })
      .setProtectedHeader({ alg: "RS256", kid, typ: "at+jwt" })
      .setAudience("https://app.recommand.eu")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifyIntegrationJwt(other)).toBeNull();
  });

  test("are verified by the published key set", async () => {
    const response = await jwks.request("/integrations/jwks");
    expect(response.status).toBe(200);
    const { keys } = await response.json();
    expect(keys).toEqual([expect.objectContaining({ alg: "RS256", kid, kty: "RSA", use: "sig" })]);
    expect(keys[0].d).toBeUndefined();
  });
});
