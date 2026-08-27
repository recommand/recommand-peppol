import type { Context } from "@recommand/lib/api";

export type ProviderSentPipelineInput = {
  /** The request that reported the document, when there is one. Only used for the
   * audit trail. */
  c?: Context<any> | null;
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  /** Sender country as reported by the access point; falls back to the company's country. */
  countryC1?: string | null;
  body: BodyInit;
  contentType?: string;
  useTestNetwork?: boolean;
  sbdhInstanceIdentifier?: string | null;
  /** The access point's own reference for the transaction it sent. */
  apTransactionId: string;
};
