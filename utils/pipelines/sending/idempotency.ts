import { idempotent } from "@core/lib/idempotency";

/**
 * A send's `Idempotency-Key` holds for the company it sends for, whichever way it's sent: the send
 * routes and the MCP server's `send_document` share it, so a key used one way can't send again another.
 */
export const sendDocumentScope = (companyId: string) => `peppol.send_document:${companyId}`;

export const sendOnce = idempotent({
  documentationUrl: "https://docs.recommand.eu/docs/sending-invoices#retry-safely",
  scope: (c) => sendDocumentScope(c.req.param("companyId") ?? ""),
});
