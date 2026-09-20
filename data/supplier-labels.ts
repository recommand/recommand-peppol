import { supportingDataSupplierLabels, labels } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and } from "drizzle-orm";
import { UserFacingError } from "@peppol/utils/util";
import { getSupplierByIdOrExternalId } from "./suppliers";

export async function assignLabelToSupplier(
  teamId: string,
  supplierId: string,
  labelId: string
): Promise<void> {
  const supplier = await getSupplierByIdOrExternalId(teamId, supplierId);

  if (!supplier) {
    throw new UserFacingError("Supplier not found");
  }

  const label = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!label) {
    throw new UserFacingError("Label not found");
  }

  const existing = await db
    .select()
    .from(supportingDataSupplierLabels)
    .where(
      and(
        eq(supportingDataSupplierLabels.supportingDataSupplierId, supplier.id),
        eq(supportingDataSupplierLabels.labelId, labelId)
      )
    )
    .then((rows) => rows[0]);

  if (existing) {
    return;
  }

  await db.insert(supportingDataSupplierLabels).values({
    supportingDataSupplierId: supplier.id,
    labelId: labelId,
  });
}

export async function unassignLabelFromSupplier(
  teamId: string,
  supplierId: string,
  labelId: string
): Promise<void> {
  const supplier = await getSupplierByIdOrExternalId(teamId, supplierId);

  if (!supplier) {
    throw new UserFacingError("Supplier not found");
  }

  const label = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.teamId, teamId)))
    .then((rows) => rows[0]);

  if (!label) {
    throw new UserFacingError("Label not found");
  }

  await db
    .delete(supportingDataSupplierLabels)
    .where(
      and(
        eq(supportingDataSupplierLabels.supportingDataSupplierId, supplier.id),
        eq(supportingDataSupplierLabels.labelId, labelId)
      )
    );
}

export async function getSupplierLabels(
  teamId: string,
  supplierId: string
) {
  const supplier = await getSupplierByIdOrExternalId(teamId, supplierId);

  if (!supplier) {
    throw new UserFacingError("Supplier not found");
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
    .from(supportingDataSupplierLabels)
    .innerJoin(labels, eq(supportingDataSupplierLabels.labelId, labels.id))
    .where(eq(supportingDataSupplierLabels.supportingDataSupplierId, supplier.id));
}

