import type { Company } from "@peppol/data/companies";
import type { OriginalPayloadContainerFormat } from "@peppol/data/offload/storage";
import type { AnyDocumentFormat } from "@peppol/utils/type-repository/document-formats/types";
import type {
  AnyDocumentType,
  DocumentTypeKey,
} from "@peppol/utils/type-repository/document-types/types";

export type ReceivingPipelineInput = {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: BodyInit;
  contentType?: string;
  skipBilling?: boolean;
  useTestNetwork?: boolean;
  playgroundTeamId?: string;
  as4MessageId?: string | null;
  as4ConversationId?: string | null;
  sbdhInstanceIdentifier?: string | null;
  apTransactionId?: string | null;
};

export type IncomingDocumentInput = {
  body: BodyInit;
  contentType?: string;
  docTypeId: string;
  processId: string;
  company: Company;
  senderId: string;
};

export type IncomingOriginalPayload = {
  content: Buffer;
  containerFormat: Exclude<OriginalPayloadContainerFormat, "none">;
};

export type PreparedIncomingPayload = {
  format: AnyDocumentFormat | undefined;
  xmlDocument: string;
  originalPayload: IncomingOriginalPayload | null;
};

export type PreparedIncomingDocument = {
  documentType: AnyDocumentType | undefined;
  type: DocumentTypeKey | "unknown";
  probableType: DocumentTypeKey | "unknown";
  parsedDocument: any;
  xmlDocument: string;
  originalPayload: IncomingOriginalPayload | null;
};
