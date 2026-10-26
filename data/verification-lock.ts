import { db } from '@recommand/db';
import { sql } from 'drizzle-orm';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class VerificationBusyError extends Error {
  constructor() {
    super('Verification is already being processed; retry shortly.');
    this.name = 'VerificationBusyError';
  }
}

/**
 * Takes a session's processing lock for the rest of the transaction, or throws
 * VerificationBusyError when the worker or another support action holds it.
 */
export async function lockVerificationSession(tx: Transaction, id: string): Promise<void> {
  // Preserve the lock key used by existing workers and rolling deployments.
  const result = await tx.execute(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${`arratech-kyc:${id}`}, 0)) as acquired`,
  );
  if (!result.rows[0]?.acquired) throw new VerificationBusyError();
}

export async function withVerificationLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await lockVerificationSession(tx, id);
    return action();
  });
}
