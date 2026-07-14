import { supportedDocumentTypeEnum, transmittedDocuments, transmittedDocumentLabels, labels } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, or, sql, desc, isNull, isNotNull, inArray, ilike, gte, lt } from "drizzle-orm";
import type { Label } from "./labels";
import { removeAttachmentsFromParsedDocument } from "@peppol/utils/parsing/remove-attachments";
import {
  offloadedDocumentS3Prefixes,
  offloadedDocumentSelect,
  resolveDocumentParsedWithAttachments,
  resolveDocumentXml,
  teamDocumentsS3Prefix,
} from "./offload/storage";
import { enqueueS3PrefixDeletions } from "./s3-deletion";
import {
  mapWithConcurrency,
  S3_REQUEST_CONCURRENCY,
} from "@peppol/utils/concurrency";

export type TransmittedDocument = typeof transmittedDocuments.$inferSelect;
export type InsertTransmittedDocument = typeof transmittedDocuments.$inferInsert;
type TransmittedDocumentSearchField = "senderName" | "receiverName" | "documentNumber" | "searchText";
type TransmittedDocumentLabel = Omit<Label, "teamId" | "createdAt" | "updatedAt">;
type InternalProviderField = "accessPointProvider" | "smpProvider" | "apTransactionId";
export type PublicTransmittedDocument = Omit<
  TransmittedDocument,
  TransmittedDocumentSearchField | InternalProviderField | "offloadClaimedAt"
>;
export type PublicTransmittedDocumentWithLabels = PublicTransmittedDocument & {
  labels?: TransmittedDocumentLabel[];
};

// Internal storage-location fields that must never be exposed to API consumers.
type InternalStorageField = "xmlLocation" | "attachmentsLocation" | "originalPayloadLocation" | "originalPayloadContainerFormat" | "s3KeyPrefix";

// Create a type that excludes the body field but includes parsed data
export type TransmittedDocumentWithoutBody = Omit<PublicTransmittedDocument, "xml" | InternalStorageField> & {
  labels?: TransmittedDocumentLabel[];
};
type InboxTransmittedDocument = Omit<PublicTransmittedDocument, "xml" | InternalStorageField | "parsed"> & {
  labels?: TransmittedDocumentLabel[];
};

const publicTransmittedDocumentSelect = {
  id: transmittedDocuments.id,
  teamId: transmittedDocuments.teamId,
  companyId: transmittedDocuments.companyId,
  direction: transmittedDocuments.direction,
  senderId: transmittedDocuments.senderId,
  receiverId: transmittedDocuments.receiverId,
  docTypeId: transmittedDocuments.docTypeId,
  processId: transmittedDocuments.processId,
  countryC1: transmittedDocuments.countryC1,
  xml: transmittedDocuments.xml,
  xmlLocation: transmittedDocuments.xmlLocation,
  attachmentsLocation: transmittedDocuments.attachmentsLocation,
  originalPayloadLocation: transmittedDocuments.originalPayloadLocation,
  originalPayloadContainerFormat: transmittedDocuments.originalPayloadContainerFormat,
  s3KeyPrefix: transmittedDocuments.s3KeyPrefix,
  sentOverPeppol: transmittedDocuments.sentOverPeppol,
  sentOverEmail: transmittedDocuments.sentOverEmail,
  emailRecipients: transmittedDocuments.emailRecipients,
  type: transmittedDocuments.type,
  parsed: transmittedDocuments.parsed,
  validation: transmittedDocuments.validation,
  peppolMessageId: transmittedDocuments.peppolMessageId,
  peppolConversationId: transmittedDocuments.peppolConversationId,
  receivedPeppolSignalMessage: transmittedDocuments.receivedPeppolSignalMessage,
  envelopeId: transmittedDocuments.envelopeId,
  readAt: transmittedDocuments.readAt,
  createdAt: transmittedDocuments.createdAt,
  updatedAt: transmittedDocuments.updatedAt,
};

// API-facing shape of a document: xml and parsed payloads resolved from wherever
// they live (so offloaded documents are indistinguishable from in-database ones),
// and the internal storage-location fields removed so they are never exposed.
export type ApiTransmittedDocument = Omit<
  PublicTransmittedDocumentWithLabels,
  InternalStorageField
>;

export async function toApiTransmittedDocument(
  doc: PublicTransmittedDocumentWithLabels
): Promise<ApiTransmittedDocument> {
  const [xml, parsed] = await Promise.all([
    resolveDocumentXml(doc),
    resolveDocumentParsedWithAttachments(doc),
  ]);
  const { xmlLocation, attachmentsLocation, originalPayloadLocation, originalPayloadContainerFormat, s3KeyPrefix, ...rest } = doc;
  return { ...rest, xml, parsed };
}

async function getLabelsForDocuments(documentIds: string[]): Promise<Map<string, TransmittedDocumentLabel[]>> {
  const documentLabelsMap = new Map<string, TransmittedDocumentLabel[]>();

  if (documentIds.length === 0) {
    return documentLabelsMap;
  }

  const documentLabels = await db
    .select({
      documentId: transmittedDocumentLabels.transmittedDocumentId,
      id: labels.id,
      externalId: labels.externalId,
      name: labels.name,
      colorHex: labels.colorHex,
    })
    .from(transmittedDocumentLabels)
    .innerJoin(labels, eq(transmittedDocumentLabels.labelId, labels.id))
    .where(inArray(transmittedDocumentLabels.transmittedDocumentId, documentIds));

  for (const label of documentLabels) {
    const existing = documentLabelsMap.get(label.documentId) || [];
    documentLabelsMap.set(label.documentId, [
      ...existing,
      {
        id: label.id,
        externalId: label.externalId,
        name: label.name,
        colorHex: label.colorHex,
      },
    ]);
  }

  return documentLabelsMap;
}

export async function getTransmittedDocuments(
  teamId: string,
  options: {
    page?: number;
    limit?: number;
    companyId?: string[];
    labelId?: string[];
    direction?: "incoming" | "outgoing";
    search?: string;
    type?: (typeof supportedDocumentTypeEnum.enumValues)[number];
    from?: Date;
    to?: Date;
    isUnread?: boolean;
    envelopeId?: string | null;
    peppolMessageId?: string | null;
    peppolConversationId?: string | null;
    excludeAttachments?: boolean;
  } = {}
): Promise<{ documents: TransmittedDocumentWithoutBody[]; total: number }> {
  const { page = 1, limit = 10, companyId, labelId, direction, search, type, from, to, isUnread, envelopeId, peppolMessageId, peppolConversationId, excludeAttachments = false } = options;
  const offset = (page - 1) * limit;
  const trimmedSearch = search?.trim();
  const normalizedLabelIds = labelId ? [...new Set(labelId)] : undefined;

  // Build the where clause
  const whereClause = [eq(transmittedDocuments.teamId, teamId)];
  if (companyId) {
    whereClause.push(inArray(transmittedDocuments.companyId, companyId));
  }
  if (normalizedLabelIds && normalizedLabelIds.length > 0) {
    const validLabelIds = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.teamId, teamId), inArray(labels.id, normalizedLabelIds)))
      .then((rows) => rows.map((row) => row.id));

    if (validLabelIds.length === 0) {
      return { documents: [], total: 0 };
    }

    whereClause.push(
      sql`exists (
        select 1
        from ${transmittedDocumentLabels}
        inner join ${labels} on ${transmittedDocumentLabels.labelId} = ${labels.id}
        where ${transmittedDocumentLabels.transmittedDocumentId} = ${transmittedDocuments.id}
          and ${labels.teamId} = ${teamId}
          and ${inArray(transmittedDocumentLabels.labelId, validLabelIds)}
      )`
    );
  }
  if (direction) {
    whereClause.push(eq(transmittedDocuments.direction, direction));
  }
  if (type) {
    whereClause.push(eq(transmittedDocuments.type, type));
  }
  if (trimmedSearch) {
    whereClause.push(
      ilike(transmittedDocuments.searchText, `%${trimmedSearch}%`)
    );
  }
  if (from) {
    whereClause.push(gte(transmittedDocuments.createdAt, from));
  }
  if (to) {
    whereClause.push(lt(transmittedDocuments.createdAt, to));
  }
  if (isUnread !== undefined) {
    if (isUnread) {
      whereClause.push(isNull(transmittedDocuments.readAt));
    } else {
      whereClause.push(isNotNull(transmittedDocuments.readAt));
    }
  }
  if (envelopeId !== undefined && envelopeId !== null) {
    whereClause.push(eq(transmittedDocuments.envelopeId, envelopeId));
  }else if (envelopeId === null) {
    whereClause.push(isNull(transmittedDocuments.envelopeId));
  }
  if (peppolMessageId !== undefined && peppolMessageId !== null) {
    whereClause.push(eq(transmittedDocuments.peppolMessageId, peppolMessageId));
  }else if (peppolMessageId === null) {
    whereClause.push(isNull(transmittedDocuments.peppolMessageId));
  }
  if (peppolConversationId !== undefined && peppolConversationId !== null) {
    whereClause.push(eq(transmittedDocuments.peppolConversationId, peppolConversationId));
  }else if (peppolConversationId === null) {
    whereClause.push(isNull(transmittedDocuments.peppolConversationId));
  }

  // Get total count
  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(transmittedDocuments)
    .where(and(...whereClause))
    .then((rows) => rows[0].count);

  // Get paginated results
  const documents = await db
    .select({
      id: transmittedDocuments.id,
      teamId: transmittedDocuments.teamId,
      companyId: transmittedDocuments.companyId,
      direction: transmittedDocuments.direction,
      senderId: transmittedDocuments.senderId,
      receiverId: transmittedDocuments.receiverId,
      docTypeId: transmittedDocuments.docTypeId,
      processId: transmittedDocuments.processId,
      countryC1: transmittedDocuments.countryC1,
      readAt: transmittedDocuments.readAt,
      createdAt: transmittedDocuments.createdAt,
      updatedAt: transmittedDocuments.updatedAt,
      type: transmittedDocuments.type,
      sentOverPeppol: transmittedDocuments.sentOverPeppol,
      sentOverEmail: transmittedDocuments.sentOverEmail,
      emailRecipients: transmittedDocuments.emailRecipients,
      parsed: transmittedDocuments.parsed,
      attachmentsLocation: transmittedDocuments.attachmentsLocation,
      originalPayloadLocation: transmittedDocuments.originalPayloadLocation,
      originalPayloadContainerFormat: transmittedDocuments.originalPayloadContainerFormat,
      s3KeyPrefix: transmittedDocuments.s3KeyPrefix,
      validation: transmittedDocuments.validation,
      peppolMessageId: transmittedDocuments.peppolMessageId,
      peppolConversationId: transmittedDocuments.peppolConversationId,
      receivedPeppolSignalMessage: transmittedDocuments.receivedPeppolSignalMessage,
      envelopeId: transmittedDocuments.envelopeId,
    })
    .from(transmittedDocuments)
    .where(and(...whereClause))
    .orderBy(desc(transmittedDocuments.createdAt))
    .limit(limit)
    .offset(offset);

  const documentIds = documents.map((doc) => doc.id);
  const documentLabelsMap = await getLabelsForDocuments(documentIds);

  const documentsWithLabels = await mapWithConcurrency(
    documents,
    S3_REQUEST_CONCURRENCY,
    async (doc) => {
      const { attachmentsLocation, originalPayloadLocation, originalPayloadContainerFormat, s3KeyPrefix, ...publicDoc } = doc;
      return {
        ...publicDoc,
        labels: documentLabelsMap.get(doc.id) || [],
        parsed: excludeAttachments
          ? (removeAttachmentsFromParsedDocument(doc.parsed) as typeof doc.parsed)
          : await resolveDocumentParsedWithAttachments({
              parsed: doc.parsed,
              attachmentsLocation,
              s3KeyPrefix,
            }),
      };
    }
  );

  return { documents: documentsWithLabels, total };
}

export async function getTransmittedDocumentsByIds(
  teamId: string,
  documentIds: string[]
): Promise<PublicTransmittedDocumentWithLabels[]> {
  const uniqueDocumentIds = [...new Set(documentIds)];

  if (uniqueDocumentIds.length === 0) {
    return [];
  }

  const documents = await db
    .select(publicTransmittedDocumentSelect)
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.teamId, teamId),
        inArray(transmittedDocuments.id, uniqueDocumentIds)
      )
    )
    .orderBy(desc(transmittedDocuments.createdAt));

  if (documents.length !== uniqueDocumentIds.length) {
    throw new Error("Some documents were not found");
  }

  const documentLabelsMap = await getLabelsForDocuments(uniqueDocumentIds);

  return documents.map((doc) => ({
    ...doc,
    labels: documentLabelsMap.get(doc.id) || [],
  }));
}

export async function deleteTransmittedDocument(
  teamId: string,
  documentId: string
): Promise<void> {
  const docs = await db
    .select(offloadedDocumentSelect)
    .from(transmittedDocuments)
    .where(and(eq(transmittedDocuments.id, documentId), eq(transmittedDocuments.teamId, teamId)));

  // Offloaded S3 objects are removed by the background deletion worker;
  // enqueueing in the same transaction as the delete means they can never be
  // orphaned, and the request doesn't wait on S3.
  await db.transaction(async (tx) => {
    await enqueueS3PrefixDeletions(tx, offloadedDocumentS3Prefixes(docs));
    await tx
      .delete(transmittedDocuments)
      .where(and(eq(transmittedDocuments.id, documentId), eq(transmittedDocuments.teamId, teamId)));
  });
}

export async function deleteTransmittedDocuments(
  teamId: string,
  documentIds: string[]
): Promise<void> {
  const uniqueDocumentIds = [...new Set(documentIds)];

  if (uniqueDocumentIds.length === 0) {
    return;
  }

  const existingDocuments = await db
    .select(offloadedDocumentSelect)
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.teamId, teamId),
        inArray(transmittedDocuments.id, uniqueDocumentIds)
      )
    );

  if (existingDocuments.length !== uniqueDocumentIds.length) {
    throw new Error("Document not found");
  }

  await db.transaction(async (tx) => {
    await enqueueS3PrefixDeletions(
      tx,
      offloadedDocumentS3Prefixes(existingDocuments)
    );
    await tx
      .delete(transmittedDocuments)
      .where(
        and(
          eq(transmittedDocuments.teamId, teamId),
          inArray(transmittedDocuments.id, uniqueDocumentIds)
        )
      );
  });
}

export async function deleteAllTransmittedDocuments(
  teamId: string
): Promise<void> {
  // All of the team's document objects live under the team's prefix, so one
  // queue row covers them all — no need to enumerate offloaded documents.
  await db.transaction(async (tx) => {
    await enqueueS3PrefixDeletions(tx, [teamDocumentsS3Prefix(teamId)]);
    await tx
      .delete(transmittedDocuments)
      .where(eq(transmittedDocuments.teamId, teamId));
  });
}

export async function getInbox(
  teamId: string,
  companyId?: string
): Promise<InboxTransmittedDocument[]> {
  // Build the where clause
  const whereClause = [
    eq(transmittedDocuments.teamId, teamId),
    eq(transmittedDocuments.direction, "incoming"),
    isNull(transmittedDocuments.readAt)
  ];

  if (companyId) {
    whereClause.push(eq(transmittedDocuments.companyId, companyId));
  }

  const documents = await db
    .select({
      id: transmittedDocuments.id,
      teamId: transmittedDocuments.teamId,
      companyId: transmittedDocuments.companyId,
      direction: transmittedDocuments.direction,
      senderId: transmittedDocuments.senderId,
      receiverId: transmittedDocuments.receiverId,
      docTypeId: transmittedDocuments.docTypeId,
      processId: transmittedDocuments.processId,
      countryC1: transmittedDocuments.countryC1,
      readAt: transmittedDocuments.readAt,
      createdAt: transmittedDocuments.createdAt,
      updatedAt: transmittedDocuments.updatedAt,
      type: transmittedDocuments.type,
      sentOverPeppol: transmittedDocuments.sentOverPeppol,
      sentOverEmail: transmittedDocuments.sentOverEmail,
      emailRecipients: transmittedDocuments.emailRecipients,
      validation: transmittedDocuments.validation,
      peppolMessageId: transmittedDocuments.peppolMessageId,
      peppolConversationId: transmittedDocuments.peppolConversationId,
      receivedPeppolSignalMessage: transmittedDocuments.receivedPeppolSignalMessage,
      envelopeId: transmittedDocuments.envelopeId,
    })
    .from(transmittedDocuments)
    .where(and(...whereClause))
    .orderBy(desc(transmittedDocuments.createdAt));

  const documentIds = documents.map((doc) => doc.id);
  const documentLabelsMap = await getLabelsForDocuments(documentIds);

  const documentsWithLabels = documents.map((doc) => ({
    ...doc,
    labels: documentLabelsMap.get(doc.id) || [],
  }));

  return documentsWithLabels;
}

export async function markAsRead(teamId: string, documentId: string, read: boolean = true): Promise<void> {
  await markDocumentsAsRead(teamId, [documentId], read);
}

export async function markDocumentsAsRead(
  teamId: string,
  documentIds: string[],
  read: boolean = true
): Promise<void> {
  const uniqueDocumentIds = [...new Set(documentIds)];

  if (uniqueDocumentIds.length === 0) {
    return;
  }

  const existingDocuments = await db
    .select({ id: transmittedDocuments.id })
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.teamId, teamId),
        inArray(transmittedDocuments.id, uniqueDocumentIds)
      )
    );

  if (existingDocuments.length !== uniqueDocumentIds.length) {
    throw new Error("Document not found");
  }

  await db
    .update(transmittedDocuments)
    .set({
      readAt: read ? new Date() : null,
    })
    .where(
      and(
        eq(transmittedDocuments.teamId, teamId),
        inArray(transmittedDocuments.id, uniqueDocumentIds)
      )
    );
}

export async function getTransmittedDocument(
  teamId: string,
  documentId: string
): Promise<PublicTransmittedDocumentWithLabels | null> {
  const document = await db
    .select(publicTransmittedDocumentSelect)
    .from(transmittedDocuments)
    .where(
      and(
        eq(transmittedDocuments.id, documentId),
        eq(transmittedDocuments.teamId, teamId)
      )
    )
    .limit(1);

  if (!document[0]) {
    return null;
  }

  const documentLabelsMap = await getLabelsForDocuments([documentId]);

  return {
    ...document[0],
    labels: documentLabelsMap.get(documentId) || [],
  };
}

export async function getAllTransmittedDocumentsInRange(
  teamId: string,
  from: Date,
  to: Date,
  direction?: "incoming" | "outgoing"
): Promise<PublicTransmittedDocumentWithLabels[]> {
  const whereClause = [
    eq(transmittedDocuments.teamId, teamId),
    gte(transmittedDocuments.createdAt, from),
    lt(transmittedDocuments.createdAt, to),
  ];

  if (direction) {
    whereClause.push(eq(transmittedDocuments.direction, direction));
  }

  const documents = await db
    .select(publicTransmittedDocumentSelect)
    .from(transmittedDocuments)
    .where(and(...whereClause))
    .orderBy(desc(transmittedDocuments.createdAt));

  const documentIds = documents.map((doc) => doc.id);
  const documentLabelsMap = await getLabelsForDocuments(documentIds);

  return documents.map((doc) => ({
    ...doc,
    labels: documentLabelsMap.get(doc.id) || [],
  }));
}
