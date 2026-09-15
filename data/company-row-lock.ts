import { companies } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The lock every writer that depends on the company's country and providers takes
 * on its row. A country change holds it for update; a verification submission and
 * an identifier write hold it for share while they re-check the company they
 * validated against and write, so they either finish before the move or see it.
 */
export async function lockCompanyRow(
  tx: Transaction,
  companyId: string,
  mode: "update" | "share"
): Promise<typeof companies.$inferSelect | undefined> {
  return await tx
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .for(mode)
    .then((rows) => rows[0]);
}

/** The fields an identifier or a verification submission was validated against. */
export type CompanyIdentitySnapshot = {
  country: string;
  smpProvider: string;
  enterpriseNumber: string | null;
  vatNumber: string | null;
};

export function sameCompanyIdentity(left: CompanyIdentitySnapshot, right: CompanyIdentitySnapshot): boolean {
  return (
    left.country === right.country &&
    left.smpProvider === right.smpProvider &&
    left.enterpriseNumber === right.enterpriseNumber &&
    left.vatNumber === right.vatNumber
  );
}
