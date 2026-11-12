import { addSeconds } from "date-fns";
import { type ActivatedIntegration } from ".";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { ulid } from "ulid";
import { getSigningKey, getVerificationKeys } from "@core/lib/signing-keys";

export async function generateIntegrationJwt(integration: ActivatedIntegration) {
    const { key, kid } = await getSigningKey();

    const jwt = await new SignJWT({
        teamId: integration.teamId,
        companyId: integration.companyId,
        integrationId: integration.id,
    })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuedAt()
        .setExpirationTime(addSeconds(new Date(), 5 * 60)) // 5 minutes
        .setJti("jti_" + ulid())
        .setIssuer("https://app.recommand.eu")
        .setAudience(["https://app.recommand.eu", integration.manifest.url])
        .sign(key);

    return jwt;
}

export async function verifyIntegrationJwt(jwt: string): Promise<JWTPayload | null> {
    // Ensure the JWT is a valid JWT, directed at app.recommand.eu (as audience), is signed by Recommand (verify with JWKS)
    try {
        const { payload, protectedHeader } = await jwtVerify(jwt, await getVerificationKeys(), {
            algorithms: ["RS256"],
            audience: "https://app.recommand.eu",
        });

        // The same keys sign other tokens too, which declare their own type
        if (protectedHeader.typ !== undefined && protectedHeader.typ.toUpperCase() !== "JWT") {
            return null;
        }

        if (!payload.teamId || !payload.integrationId || !payload.companyId) {
            return null;
        }

        return payload;
    } catch (error) {
        console.error(error);
        return null;
    }
}