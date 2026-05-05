import { transmittedDocumentLabels, transmittedDocuments, labels } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, inArray } from "drizzle-orm";
import { UserFacingError } from "@peppol/utils/util";
import { getLabelsForSuppliers } from "./suppliers";
import { publishEvent } from "@core/data/rules/events";

export async function assignLabelToDocument(
  teamId: string,
  documentId: string,
  labelId: string
): Promise<void> {
  const document = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      senderId: transmittedDocuments.senderId,
      receiverId: transmittedDocuments.receiverId,
    })
    .from(transmittedDocuments)
    .where(and(eq(transmittedDocuments.id, documentId), eq(transmittedDocuments.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!document) {
    throw new UserFacingError("Document not found");
  }

  const label = await db
    .select({ id: labels.id, externalId: labels.externalId })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!label) {
    throw new UserFacingError("Label not found");
  }

  const existing = await db
    .select()
    .from(transmittedDocumentLabels)
    .where(
      and(
        eq(transmittedDocumentLabels.transmittedDocumentId, documentId),
        eq(transmittedDocumentLabels.labelId, labelId)
      )
    )
    .then((rows) => rows[0]);

  if (existing) {
    return;
  }

  await db.insert(transmittedDocumentLabels).values({
    transmittedDocumentId: documentId,
    labelId: labelId,
  });

  await publishEvent("peppol.document.label.assigned.v1", {
    teamId,
    aggregateType: "peppol.document",
    aggregateId: documentId,
    idempotencyKey: `peppol.document.label.assigned:${documentId}:${labelId}`,
    payload: {
      companyId: document.companyId,
      labelId,
      labelExternalId: label.externalId ?? null,
      docType: document.type,
      senderId: document.senderId,
      receiverId: document.receiverId ?? null,
    },
  });
}

export async function assignLabelToDocuments(
  teamId: string,
  documentIds: string[],
  labelId: string
): Promise<void> {
  const uniqueDocumentIds = [...new Set(documentIds)];

  if (uniqueDocumentIds.length === 0) {
    return;
  }

  const teamDocuments = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      senderId: transmittedDocuments.senderId,
      receiverId: transmittedDocuments.receiverId,
    })
    .from(transmittedDocuments)
    .where(and(eq(transmittedDocuments.teamId, teamId), inArray(transmittedDocuments.id, uniqueDocumentIds)));

  if (teamDocuments.length !== uniqueDocumentIds.length) {
    throw new UserFacingError("Document not found");
  }

  const label = await db
    .select({ id: labels.id, externalId: labels.externalId })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!label) {
    throw new UserFacingError("Label not found");
  }

  const existingAssignments = await db
    .select({ transmittedDocumentId: transmittedDocumentLabels.transmittedDocumentId })
    .from(transmittedDocumentLabels)
    .where(
      and(
        inArray(transmittedDocumentLabels.transmittedDocumentId, uniqueDocumentIds),
        eq(transmittedDocumentLabels.labelId, labelId)
      )
    );

  const existingDocumentIds = new Set(existingAssignments.map((assignment) => assignment.transmittedDocumentId));
  const documentsToAssign = teamDocuments.filter((document) => !existingDocumentIds.has(document.id));

  if (documentsToAssign.length === 0) {
    return;
  }

  await db
    .insert(transmittedDocumentLabels)
    .values(
      documentsToAssign.map((document) => ({
        transmittedDocumentId: document.id,
        labelId,
      }))
    )
    .onConflictDoNothing();

  await Promise.all(
    documentsToAssign.map((document) =>
      publishEvent("peppol.document.label.assigned.v1", {
        teamId,
        aggregateType: "peppol.document",
        aggregateId: document.id,
        idempotencyKey: `peppol.document.label.assigned:${document.id}:${labelId}`,
        payload: {
          companyId: document.companyId,
          labelId,
          labelExternalId: label.externalId ?? null,
          docType: document.type,
          senderId: document.senderId,
          receiverId: document.receiverId ?? null,
        },
      })
    )
  );
}

export async function unassignLabelFromDocument(
  teamId: string,
  documentId: string,
  labelId: string
): Promise<void> {
  const document = await db
    .select({
      id: transmittedDocuments.id,
      companyId: transmittedDocuments.companyId,
      type: transmittedDocuments.type,
      senderId: transmittedDocuments.senderId,
      receiverId: transmittedDocuments.receiverId,
    })
    .from(transmittedDocuments)
    .where(and(eq(transmittedDocuments.id, documentId), eq(transmittedDocuments.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!document) {
    throw new UserFacingError("Document not found");
  }

  const label = await db
    .select({ id: labels.id, externalId: labels.externalId })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!label) {
    throw new UserFacingError("Label not found");
  }

  await db
    .delete(transmittedDocumentLabels)
    .where(
      and(
        eq(transmittedDocumentLabels.transmittedDocumentId, documentId),
        eq(transmittedDocumentLabels.labelId, labelId)
      )
    );

  await publishEvent("peppol.document.label.unassigned.v1", {
    teamId,
    aggregateType: "peppol.document",
    aggregateId: documentId,
    idempotencyKey: `peppol.document.label.unassigned:${documentId}:${labelId}`,
    payload: {
      companyId: document.companyId,
      labelId,
      labelExternalId: label.externalId ?? null,
      docType: document.type,
      senderId: document.senderId,
      receiverId: document.receiverId ?? null,
    },
  });
}

export async function getDocumentLabels(
  teamId: string,
  documentId: string
) {
  const document = await db
    .select({ id: transmittedDocuments.id })
    .from(transmittedDocuments)
    .where(and(eq(transmittedDocuments.id, documentId), eq(transmittedDocuments.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!document) {
    throw new UserFacingError("Document not found");
  }

  return await db
    .select({
      id: labels.id,
      teamId: labels.teamId,
      externalId: labels.externalId,
      name: labels.name,
      colorHex: labels.colorHex,
      createdAt: labels.createdAt,
      updatedAt: labels.updatedAt,
    })
    .from(transmittedDocumentLabels)
    .innerJoin(labels, eq(transmittedDocumentLabels.labelId, labels.id))
    .where(eq(transmittedDocumentLabels.transmittedDocumentId, documentId));
}

export async function assignSupplierLabelsToDocument(
  teamId: string,
  documentId: string,
  supplierId: string
): Promise<number> {
  const supplierLabelsMap = await getLabelsForSuppliers([supplierId]);
  const supplierLabels = supplierLabelsMap.get(supplierId) || [];

  if (supplierLabels.length === 0) {
    return 0;
  }

  let assignedCount = 0;

  for (const label of supplierLabels) {
    try {
      await assignLabelToDocument(teamId, documentId, label.id);
      assignedCount++;
    } catch (error) {
      console.error(`Failed to assign label ${label.id} to document ${documentId}:`, error);
    }
  }

  return assignedCount;
}
