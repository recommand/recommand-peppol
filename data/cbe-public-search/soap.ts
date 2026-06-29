import { XMLBuilder } from "fast-xml-parser";
import { createHash, randomBytes, randomUUID } from "crypto";

export const KBO_ENDPOINT = "https://kbopub.economie.fgov.be/kbopubws180000/services/wsKBOPub";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
});

export function getKboCredentials(): { username: string; password: string } {
  const username = process.env.CBE_USERNAME;
  const password = process.env.CBE_PASSWORD;

  if (!username || !password) {
    throw new Error("CBE_USERNAME and CBE_PASSWORD environment variables must be set");
  }

  return { username, password };
}

export async function callKboSoap({
  credentials,
  soapAction,
  requestBody,
  endpoint = KBO_ENDPOINT,
}: {
  credentials: { username: string; password: string };
  soapAction: string;
  requestBody: Record<string, unknown>;
  endpoint?: string;
}): Promise<string> {
  const nonce = randomBytes(16);
  const nonceBase64 = nonce.toString("base64");
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300 * 1000).toISOString();

  const passwordDigest = createHash("sha1")
    .update(nonce)
    .update(created)
    .update(credentials.password)
    .digest("base64");

  const requestId = randomUUID();

  const soapEnvelope = {
    "soapenv:Envelope": {
      "@_xmlns:soapenv": "http://schemas.xmlsoap.org/soap/envelope/",
      "@_xmlns:mes": "http://economie.fgov.be/kbopub/webservices/v1/messages",
      "@_xmlns:dat": "http://economie.fgov.be/kbopub/webservices/v1/datamodel",
      "@_xmlns:wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
      "@_xmlns:wsu": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
      "soapenv:Header": {
        "wsse:Security": {
          "wsu:Timestamp": {
            "wsu:Created": created,
            "wsu:Expires": expires,
          },
          "wsse:UsernameToken": {
            "wsse:Username": credentials.username,
            "wsse:Password": {
              "@_Type": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest",
              "#text": passwordDigest,
            },
            "wsse:Nonce": {
              "@_EncodingType": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary",
              "#text": nonceBase64,
            },
            "wsu:Created": created,
          },
        },
        "mes:RequestContext": {
          "mes:Id": requestId,
          "mes:Language": "nl",
        },
      },
      "soapenv:Body": requestBody,
    },
  };

  const soapBody = builder.build(soapEnvelope);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
      "SOAPAction": `"${soapAction}"`,
    },
    body: soapBody,
  });

  if (!response.ok) {
    throw new Error(`CBE API error: ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  return response.text();
}
