import { supportingDataCustomers } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, sql, desc, or, ilike, SQL } from "drizzle-orm";
import { UserFacingError } from "@peppol/utils/util";

export type Customer = typeof supportingDataCustomers.$inferSelect;
export type InsertCustomer = typeof supportingDataCustomers.$inferInsert;

export async function getCustomers(
  teamId: string,
  options: {
    page?: number;
    limit?: number;
    search?: string;
  } = {}
): Promise<{ customers: Customer[]; total: number }> {
  const { page = 1, limit = 10, search } = options;
  const offset = (page - 1) * limit;

  const whereClause: SQL[] = [eq(supportingDataCustomers.teamId, teamId)];
  if (search) {
    whereClause.push(
      or(
        ilike(supportingDataCustomers.id, `%${search}%`),
        ilike(supportingDataCustomers.name, `%${search}%`),
        ilike(supportingDataCustomers.vatNumber, `%${search}%`),
        ilike(supportingDataCustomers.enterpriseNumber, `%${search}%`),
        ilike(supportingDataCustomers.externalId, `%${search}%`),
        ilike(supportingDataCustomers.address, `%${search}%`),
        ilike(supportingDataCustomers.city, `%${search}%`),
        ilike(supportingDataCustomers.postalCode, `%${search}%`),
        ilike(supportingDataCustomers.country, `%${search}%`),
        ilike(supportingDataCustomers.email, `%${search}%`)
      ) as SQL
    );
  }

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(supportingDataCustomers)
    .where(and(...whereClause))
    .then((rows) => rows[0].count);

  const customers = await db
    .select()
    .from(supportingDataCustomers)
    .where(and(...whereClause))
    .orderBy(desc(supportingDataCustomers.createdAt))
    .limit(limit)
    .offset(offset);

  return { customers, total };
}

export async function getCustomer(
  teamId: string,
  options: {
    id?: string;
    externalId?: string | null;
  }
): Promise<Customer | null> {
  const { id, externalId } = options;
  if (!id && !externalId) {
    return null;
  }

  const whereClause: SQL[] = [eq(supportingDataCustomers.teamId, teamId)];

  const whereIdOrExternalId: SQL[] = [];
  if (id) {
    whereIdOrExternalId.push(eq(supportingDataCustomers.id, id));
  }
  if (externalId) {
    whereIdOrExternalId.push(
      eq(supportingDataCustomers.externalId, externalId)
    );
  }

  if (whereIdOrExternalId.length > 0) {
    whereClause.push(or(...whereIdOrExternalId) as SQL);
  }

  return await db
    .select()
    .from(supportingDataCustomers)
    .where(and(...whereClause))
    .then((rows) => rows[0]);
}

export async function getCustomerByIdOrExternalId(
  teamId: string,
  customerId: string
): Promise<Customer | null> {
  return await getCustomer(teamId, { id: customerId, externalId: customerId });
}

export async function upsertCustomer(
  data: Partial<InsertCustomer> & {
    teamId: string;
    name: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
    id?: string;
    externalId?: string | null;
    vatNumber?: string | null;
    enterpriseNumber?: string | null;
    peppolAddresses?: string[];
    email?: string | null;
    phone?: string | null;
  }
): Promise<Customer> {
  const {
    id,
    externalId,
    teamId,
    name,
    vatNumber,
    enterpriseNumber,
    peppolAddresses,
    address,
    city,
    postalCode,
    country,
    email,
    phone,
  } = data;

  let existingCustomer: Customer | null = null;

  if (id) {
    existingCustomer = await getCustomer(teamId, { id });
    if (!existingCustomer) {
      throw new UserFacingError("Customer not found");
    }
  } else if (externalId !== undefined && externalId !== null) {
    existingCustomer = await getCustomer(teamId, { externalId });
  }

  if (existingCustomer) {
    const updateData: Partial<InsertCustomer> = {
      name,
      vatNumber: vatNumber ?? null,
      enterpriseNumber: enterpriseNumber ?? null,
      peppolAddresses: peppolAddresses ?? [],
      address,
      city,
      postalCode,
      country,
      email: email ?? null,
      phone: phone ?? null,
    };

    if (externalId !== undefined) {
      updateData.externalId = externalId ?? null;
    }

    return await db
      .update(supportingDataCustomers)
      .set(updateData)
      .where(eq(supportingDataCustomers.id, existingCustomer.id))
      .returning()
      .then((rows) => rows[0]);
  }

  const insertData: InsertCustomer = {
    teamId,
    name,
    externalId: externalId ?? null,
    vatNumber: vatNumber ?? null,
    enterpriseNumber: enterpriseNumber ?? null,
    peppolAddresses: peppolAddresses ?? [],
    address,
    city,
    postalCode,
    country,
    email: email ?? null,
    phone: phone ?? null,
  };

  return await db
    .insert(supportingDataCustomers)
    .values(insertData)
    .returning()
    .then((rows) => rows[0]);
}

export async function deleteCustomer(
  teamId: string,
  customerId: string
): Promise<void> {
  const customer = await getCustomerByIdOrExternalId(teamId, customerId);
  if (!customer) {
    throw new UserFacingError("Customer not found");
  }

  await db
    .delete(supportingDataCustomers)
    .where(
      and(
        eq(supportingDataCustomers.teamId, teamId),
        eq(supportingDataCustomers.id, customer.id)
      )
    );
}
