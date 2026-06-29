import { companyDocumentTypes } from "@peppol/db/schema";
import { UserFacingError } from "@peppol/utils/util";
import { db } from "@recommand/db";
import { eq, and, asc } from "drizzle-orm";
import { unregisterCompanyDocumentType, upsertCompanyRegistrations } from "./smp-providers";

export type CompanyDocumentType = typeof companyDocumentTypes.$inferSelect;
export type InsertCompanyDocumentType = typeof companyDocumentTypes.$inferInsert;

export async function getCompanyDocumentTypes(companyId: string): Promise<CompanyDocumentType[]> {
  return await db
    .select()
    .from(companyDocumentTypes)
    .where(eq(companyDocumentTypes.companyId, companyId))
    .orderBy(asc(companyDocumentTypes.docTypeId));
}

export async function getCompanyDocumentType(
  companyId: string,
  documentTypeId: string
): Promise<CompanyDocumentType | undefined> {
  return await db
    .select()
    .from(companyDocumentTypes)
    .where(
      and(
        eq(companyDocumentTypes.companyId, companyId),
        eq(companyDocumentTypes.id, documentTypeId)
      )
    )
    .then((rows) => rows[0]);
}

export async function getCompanyDocumentTypeByDocTypeAndProcess(
  companyId: string,
  docTypeId: string,
  processId: string
): Promise<CompanyDocumentType | undefined> {
  return await db
    .select()
    .from(companyDocumentTypes)
    .where(
      and(
        eq(companyDocumentTypes.companyId, companyId),
        eq(companyDocumentTypes.docTypeId, docTypeId),
        eq(companyDocumentTypes.processId, processId)
      )
    )
    .then((rows) => rows[0]);
}

export async function createCompanyDocumentType({
  companyDocumentType,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyDocumentType: InsertCompanyDocumentType;
  skipSmpRegistration: boolean;
  useTestNetwork: boolean;
}): Promise<CompanyDocumentType> {
  // Check if there already exists a document type with the same docTypeId and processId for this company
  const existingDocumentType = await getCompanyDocumentTypeByDocTypeAndProcess(
    companyDocumentType.companyId,
    companyDocumentType.docTypeId,
    companyDocumentType.processId
  );

  if (existingDocumentType) {
    throw new UserFacingError(
      `Company document type with docTypeId '${companyDocumentType.docTypeId}' and processId '${companyDocumentType.processId}' already exists`
    );
  }

  const createdDocumentType = await db
    .insert(companyDocumentTypes)
    .values(companyDocumentType)
    .returning()
    .then((rows) => rows[0]);

  if(!skipSmpRegistration){
    try {
      await upsertCompanyRegistrations({companyId: companyDocumentType.companyId, useTestNetwork});
    } catch (error) {
      // If registration fails, rollback the creation of the document type
      await db.delete(companyDocumentTypes).where(eq(companyDocumentTypes.id, createdDocumentType.id));
      throw error;
    }
  }

  return createdDocumentType;
}

export async function updateCompanyDocumentType({
  companyDocumentType,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyDocumentType: InsertCompanyDocumentType & { id: string };
  skipSmpRegistration: boolean;
  useTestNetwork: boolean;
}): Promise<CompanyDocumentType> {
  const oldDocumentType = await getCompanyDocumentType(
    companyDocumentType.companyId,
    companyDocumentType.id
  );
  
  if (!oldDocumentType) {
    throw new UserFacingError("Company document type not found");
  }

  // Check if there already exists another document type with the same docTypeId and processId for this company
  const existingDocumentType = await getCompanyDocumentTypeByDocTypeAndProcess(
    companyDocumentType.companyId,
    companyDocumentType.docTypeId,
    companyDocumentType.processId
  );

  if (existingDocumentType && existingDocumentType.id !== companyDocumentType.id) {
    throw new UserFacingError(
      `Company document type with docTypeId '${companyDocumentType.docTypeId}' and processId '${companyDocumentType.processId}' already exists`
    );
  }

  // Return if there is no change
  if(oldDocumentType.docTypeId === companyDocumentType.docTypeId && oldDocumentType.processId === companyDocumentType.processId){
    return oldDocumentType;
  }

  const updatedDocumentType = await db
    .update(companyDocumentTypes)
    .set(companyDocumentType)
    .where(
      and(
        eq(companyDocumentTypes.companyId, companyDocumentType.companyId),
        eq(companyDocumentTypes.id, companyDocumentType.id)
      )
    )
    .returning()
    .then((rows) => rows[0]);

  if(!skipSmpRegistration){
    try {
      await unregisterCompanyDocumentType({documentType: oldDocumentType, useTestNetwork}); // Unregister the old document type
      await upsertCompanyRegistrations({companyId: companyDocumentType.companyId, useTestNetwork}); // Register the new document type
    } catch (error) {
      // If registration fails, rollback the update of the document type
      await db.update(companyDocumentTypes).set(oldDocumentType).where(eq(companyDocumentTypes.id, companyDocumentType.id));
      throw error;
    }
  }

  return updatedDocumentType;
}

export async function deleteCompanyDocumentType({
  companyId,
  documentTypeId,
  skipSmpRegistration,
  useTestNetwork,
}:{
  companyId: string;
  documentTypeId: string;
  skipSmpRegistration: boolean;
  useTestNetwork: boolean;
}): Promise<void> {
  const documentType = await getCompanyDocumentType(companyId, documentTypeId);
  if (!documentType) {
    throw new UserFacingError("Company document type not found");
  }

  if(!skipSmpRegistration){
    await unregisterCompanyDocumentType({documentType, useTestNetwork});
  }

  await db
    .delete(companyDocumentTypes)
    .where(
      and(
        eq(companyDocumentTypes.companyId, companyId),
        eq(companyDocumentTypes.id, documentTypeId)
      )
    );
}
