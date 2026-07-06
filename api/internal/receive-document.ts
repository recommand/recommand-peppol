import { Server } from "@recommand/lib/api";
import { zodValidator } from "@recommand/lib/zod-validator";
import { z } from "zod";
import { requireInternalToken } from "@peppol/utils/auth-middleware";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { receiveDocument } from "@peppol/data/receive-document";
import { UserFacingError } from "@peppol/utils/util";
import { describeRoute } from "hono-openapi";

export const receiveDocumentSchema = z.object({
  senderId: z.string(),
  receiverId: z.string(),
  docTypeId: z.string(),
  processId: z.string(),
  countryC1: z.string(),
  body: z.string(),
  contentType: z.string().optional(),
  as4MessageId: z.string().nullish(),
  as4ConversationId: z.string().nullish(),
  sbdhInstanceIdentifier: z.string().nullish(),
});

const server = new Server();

function isXmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }
  const mimeType = contentType.toLowerCase().split(";")[0].trim();
  return mimeType === "application/xml";
}

server.post(
  "/receiveDocument",
  requireInternalToken(),
  describeRoute({hide: true}),
  zodValidator("json", receiveDocumentSchema),
  async (c) => {
    const jsonBody = c.req.valid("json");

    try {
      const useTestNetwork = c.get("token") !== process.env.INTERNAL_TOKEN;
      const body = isXmlContentType(jsonBody.contentType)
        ? jsonBody.body
        : new Blob([Buffer.from(jsonBody.body, "base64")], {
          type: jsonBody.contentType,
        });
      await receiveDocument({...jsonBody, body, useTestNetwork});
    } catch (error) {
      console.error("Error receiving document:", error);
      if (error instanceof UserFacingError) {
        return c.json(actionFailure(error), 400);
      }
      return c.json(actionFailure("Unknown error"), 500);
    }

    return c.json(actionSuccess(), 200);
  }
);

export default server;
