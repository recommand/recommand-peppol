import { db } from '@recommand/db';
import { sql } from 'drizzle-orm';

export class VerificationBusyError extends Error {
  constructor() {
    super('Verification is already being processed; retry shortly.');
    this.name = 'VerificationBusyError';
  }
}

export async function withVerificationLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    // Preserve the lock key used by existing workers and rolling deployments.
    const result = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`arratech-kyc:${id}`}, 0)) as acquired`,
    );
    if (!result.rows[0]?.acquired) throw new VerificationBusyError();
    return action();
  });
}
