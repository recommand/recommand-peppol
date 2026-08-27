import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import type { SendDocumentRecordingContext } from "@peppol/data/send-document-recording";
import type { CompanyAccessContext } from "@peppol/utils/auth-middleware";
import type { sendDocumentSchema } from "@peppol/utils/parsing/send-document";
import type { Context } from "@recommand/lib/api";
import type { z } from "zod";

export type SendingContext = Context<
  AuthenticatedUserContext &
    AuthenticatedTeamContext &
    CompanyAccessContext &
    SendDocumentRecordingContext,
  string,
  {
    in: { json: z.input<typeof sendDocumentSchema> };
    out: { json: z.infer<typeof sendDocumentSchema> };
  }
>;

export type SendingInput = z.infer<typeof sendDocumentSchema>;

export type PreparedDocument = {
  type: string;
  parsed: any;
  xml: string;
  docTypeId: string;
  processId: string;
  body: BodyInit;
  contentType: string;
  originalPayload: { content: Buffer; containerFormat: "pdf" } | null;
  /**
   * Why the document cannot be transmitted over Peppol, when autorouting established
   * that the recipient receives nothing this document can be sent as. The document is
   * still prepared, so email delivery keeps working.
   */
  peppolRoutingFailure?: string;
};
