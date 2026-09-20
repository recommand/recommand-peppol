import { supportingDataSuppliers, supportingDataSupplierLabels, labels } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, sql, desc, inArray, or, ilike, SQL } from "drizzle-orm";
import type { Label } from "@peppol/data/labels";
import { UserFacingError } from "@peppol/utils/util";

export type Supplier = typeof supportingDataSuppliers.$inferSelect;
export type InsertSupplier = typeof supportingDataSuppliers.$inferInsert;

export type SupplierWithLabels = Supplier & {
  labels?: Omit<Label,  "teamId" | "createdAt" | "updatedAt">[];
};

export async function getLabelsForSuppliers(supplierIds: string[]): Promise<Map<string, Omit<Label, "teamId" | "createdAt" | "updatedAt">[]>> {
  const supplierLabelsMap = new Map<string, Omit<Label, "teamId" | "createdAt" | "updatedAt">[]>();

  if (supplierIds.length === 0) {
    return supplierLabelsMap;
  }

  const supplierLabels = await db
    .select({
      supplierId: supportingDataSupplierLabels.supportingDataSupplierId,
      id: labels.id,
      teamId: labels.teamId,
      externalId: labels.externalId,
      name: labels.name,
      colorHex: labels.colorHex,
    })
    .from(supportingDataSupplierLabels)
    .innerJoin(labels, eq(supportingDataSupplierLabels.labelId, labels.id))
    .where(inArray(supportingDataSupplierLabels.supportingDataSupplierId, supplierIds));

  for (const label of supplierLabels) {
    const existing = supplierLabelsMap.get(label.supplierId) || [];
    supplierLabelsMap.set(label.supplierId, [
      ...existing,
      {
        id: label.id,
        externalId: label.externalId,
        name: label.name,
        colorHex: label.colorHex,
      },
    ]);
  }

  return supplierLabelsMap;
}

export async function getSuppliers(
  teamId: string,
  options: {
    page?: number;
    limit?: number;
    search?: string;
  } = {}
): Promise<{ suppliers: SupplierWithLabels[]; total: number }> {
  const { page = 1, limit = 10, search } = options;
  const offset = (page - 1) * limit;

  const whereClause = [eq(supportingDataSuppliers.teamId, teamId)];
  if (search) {
    whereClause.push(
      or(
        ilike(supportingDataSuppliers.id, `%${search}%`),
        ilike(supportingDataSuppliers.name, `%${search}%`),
        ilike(supportingDataSuppliers.vatNumber, `%${search}%`),
        ilike(supportingDataSuppliers.externalId, `%${search}%`)
      ) as SQL
    );
  }

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(supportingDataSuppliers)
    .where(and(...whereClause))
    .then((rows) => rows[0].count);

  const suppliers = await db
    .select({
      id: supportingDataSuppliers.id,
      teamId: supportingDataSuppliers.teamId,
      externalId: supportingDataSuppliers.externalId,
      name: supportingDataSuppliers.name,
      vatNumber: supportingDataSuppliers.vatNumber,
      peppolAddresses: supportingDataSuppliers.peppolAddresses,
      createdAt: supportingDataSuppliers.createdAt,
      updatedAt: supportingDataSuppliers.updatedAt,
    })
    .from(supportingDataSuppliers)
    .where(and(...whereClause))
    .orderBy(desc(supportingDataSuppliers.createdAt))
    .limit(limit)
    .offset(offset);

  const supplierIds = suppliers.map((supplier) => supplier.id);
  const supplierLabelsMap = await getLabelsForSuppliers(supplierIds);

  const suppliersWithLabels = suppliers.map((supplier) => ({
    ...supplier,
    labels: supplierLabelsMap.get(supplier.id) || [],
  }));

  return { suppliers: suppliersWithLabels, total };
}

export async function getSupplier(
  teamId: string,
  options: {
    id?: string;
    externalId?: string | null;
  }
): Promise<Supplier | null> {
  const { id, externalId } = options;
  if(!id && !externalId) {
    return null;
  }

  const whereClause = [eq(supportingDataSuppliers.teamId, teamId)];

  const whereIdOrExternalId: SQL[] = [];
  if (id) {
    whereIdOrExternalId.push(eq(supportingDataSuppliers.id, id));
  }
  if (externalId) {
    whereIdOrExternalId.push(eq(supportingDataSuppliers.externalId, externalId));
  }

  if(whereIdOrExternalId.length > 0) {
    whereClause.push(or(...whereIdOrExternalId) as SQL);
  }


  return await db
    .select()
    .from(supportingDataSuppliers)
    .where(and(...whereClause))
    .then((rows) => rows[0]);
}

export async function getSupplierByIdOrExternalId(
  teamId: string,
  supplierId: string
): Promise<Supplier | null> {
  return await getSupplier(teamId, { id: supplierId, externalId: supplierId });
}

export async function upsertSupplier(
  data: Partial<InsertSupplier> & {
    teamId: string;
    name: string;
    id?: string;
    externalId?: string | null;
    vatNumber?: string | null;
    peppolAddresses?: string[];
  }
): Promise<SupplierWithLabels> {
  const { id, externalId, teamId, name, vatNumber, peppolAddresses } = data;

  let existingSupplier: Supplier | null = null;

  if (id) {
    existingSupplier = await getSupplier(teamId, { id });
    if (!existingSupplier) {
      throw new UserFacingError("Supplier not found");
    }
  } else if (externalId !== undefined && externalId !== null) {
    existingSupplier = await getSupplier(teamId, { externalId });
  }

  let supplier: Supplier;

  if (existingSupplier) {
    const updateData: Partial<InsertSupplier> = {
      name,
      vatNumber: vatNumber ?? null,
      peppolAddresses: peppolAddresses ?? [],
    };

    if (externalId !== undefined) {
      updateData.externalId = externalId ?? null;
    }

    supplier = await db
      .update(supportingDataSuppliers)
      .set(updateData)
      .where(eq(supportingDataSuppliers.id, existingSupplier.id))
      .returning()
      .then((rows) => rows[0]);
  } else {
    const insertData: InsertSupplier = {
      teamId,
      name,
      externalId: externalId ?? null,
      vatNumber: vatNumber ?? null,
      peppolAddresses: peppolAddresses ?? [],
    };

    supplier = await db
      .insert(supportingDataSuppliers)
      .values(insertData)
      .returning()
      .then((rows) => rows[0]);
  }

  const supplierIds = [supplier.id];
  const supplierLabelsMap = await getLabelsForSuppliers(supplierIds);

  return {
    ...supplier,
    labels: supplierLabelsMap.get(supplier.id) || [],
  };
}

export async function deleteSupplier(
  teamId: string,
  supplierId: string
): Promise<void> {
  const supplier = await getSupplierByIdOrExternalId(teamId, supplierId);
  if (!supplier) {
    throw new UserFacingError("Supplier not found");
  }

  await db
    .delete(supportingDataSuppliers)
    .where(
      and(
        eq(supportingDataSuppliers.teamId, teamId),
        eq(supportingDataSuppliers.id, supplier.id)
      )
    );
}

export async function findSupplierByVatAndPeppolId(
  teamId: string,
  vatNumber: string | null | undefined,
  peppolId: string | null | undefined
): Promise<Supplier | null> {
  const whereClause: SQL[] = [eq(supportingDataSuppliers.teamId, teamId)];

  const matchConditions: SQL[] = [];

  if (vatNumber) {
    matchConditions.push(eq(supportingDataSuppliers.vatNumber, vatNumber));
  }

  if (peppolId) {
    matchConditions.push(
      sql`${supportingDataSuppliers.peppolAddresses} @> ARRAY[${peppolId}]::text[]`
    );
  }

  if (matchConditions.length === 0) {
    return null;
  }

  whereClause.push(or(...matchConditions) as SQL);

  return await db
    .select()
    .from(supportingDataSuppliers)
    .where(and(...whereClause))
    .limit(1)
    .then((rows) => rows[0] || null);
}

