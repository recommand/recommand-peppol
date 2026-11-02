import { randomBytes } from "node:crypto";
import { publishEvent } from "@core/data/rules/events";
import { inboundAddresses } from "@peppol/db/schema";
import { base32Encode } from "@peppol/utils/base32";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import { db } from "@recommand/db";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

export type InboundAddress = typeof inboundAddresses.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function eventArgs(type: string, row: InboundAddress, tx: Transaction) {
  return {
    teamId: row.teamId,
    streamId: row.companyId,
    aggregateType: "peppol.inbound_address",
    aggregateId: row.id,
    idempotencyKey: `${type}:${row.id}:${row.revision}`,
    tx,
  };
}

/** The address was created or changed, in the transaction that did it. */
async function publishInboundAddressChanged(row: InboundAddress, tx: Transaction) {
  await publishEvent("peppol.inbound_address.changed.v1", {
    ...eventArgs("peppol.inbound_address.changed", row, tx),
    payload: {
      companyId: row.companyId,
      inboundAddressId: row.id,
      address: row.address,
      enabled: row.enabled,
      status: row.enabled ? row.status : "disabled",
      acceptedTypes: row.acceptedTypes ?? null,
      revision: row.revision,
    },
  });
}

async function publishInboundAddressDeleted(row: InboundAddress, tx: Transaction) {
  await publishEvent("peppol.inbound_address.deleted.v1", {
    ...eventArgs("peppol.inbound_address.deleted", row, tx),
    payload: {
      companyId: row.companyId,
      inboundAddressId: row.id,
      address: row.address,
      revision: row.revision,
      deletedAt: (row.deletedAt ?? new Date()).toISOString(),
      reason: "deleted",
    },
  });
}

/** The domain Recommand receives intake email on. Its MX record points to the mail provider. */
export function inboundEmailDomain(): string {
  return (process.env.INBOUND_EMAIL_DOMAIN || "in.recommand.eu").toLowerCase();
}

/** A local part nobody can guess, so an address cannot be found by trying. */
function randomLocalPart(): string {
  return base32Encode(randomBytes(10)).toLowerCase().slice(0, 16);
}

/**
 * Give a company a new address on the Recommand inbound domain. It works at once: the
 * domain receives every address, so there is nothing to provision. `toResponse` gives
 * the body of the creating response, stored with the address for an idempotent replay.
 */
export async function createInboundAddress(
  input: {
    teamId: string;
    companyId: string;
    enabled: boolean;
    acceptedTypes: string[] | null;
    idempotencyKey: string | null;
    requestHash: string | null;
  },
  toResponse?: (row: InboundAddress) => Record<string, unknown>,
): Promise<InboundAddress> {
  for (let attempt = 0; ; attempt++) {
    const localPart = randomLocalPart();
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(inboundAddresses)
          .values({ ...input, localPart, address: `${localPart}@${inboundEmailDomain()}`, status: "active" })
          .returning();
        await publishInboundAddressChanged(row, tx);
        if (!toResponse) {
          return row;
        }
        const [withResponse] = await tx
          .update(inboundAddresses)
          .set({ idempotencyResponse: toResponse(row) })
          .where(eq(inboundAddresses.id, row.id))
          .returning();
        return withResponse;
      });
    } catch (error) {
      // A local part that is taken: draw again. A taken idempotency key is the caller's to handle.
      const localPartTaken =
        isUniqueViolation(error) &&
        String((error as { constraint?: string }).constraint ?? (error as Error).message).includes("local_part");
      if (!localPartTaken || attempt >= 3) {
        throw error;
      }
    }
  }
}

/** An address of a company by id, deleted or not. */
export async function getInboundAddress(companyId: string, id: string): Promise<InboundAddress | null> {
  const [row] = await db
    .select()
    .from(inboundAddresses)
    .where(and(eq(inboundAddresses.companyId, companyId), eq(inboundAddresses.id, id)));
  return row ?? null;
}

export async function findInboundAddressByIdempotencyKey(companyId: string, key: string): Promise<InboundAddress | null> {
  const [row] = await db
    .select()
    .from(inboundAddresses)
    .where(and(eq(inboundAddresses.companyId, companyId), eq(inboundAddresses.idempotencyKey, key)));
  return row ?? null;
}

/** The address a message was sent to, by its full address, deleted or not. */
export async function findInboundAddressByEmail(email: string): Promise<InboundAddress | null> {
  const [localPart, domain] = email.trim().toLowerCase().split("@");
  if (!localPart || domain !== inboundEmailDomain()) {
    return null;
  }
  // A plus suffix (address+tag@domain) still reaches the address.
  const [row] = await db
    .select()
    .from(inboundAddresses)
    .where(eq(inboundAddresses.localPart, localPart.split("+")[0]));
  return row ?? null;
}

/** A company's addresses that are not deleted, newest first by their ULID id, after an address in that order. */
export async function listInboundAddresses(
  companyId: string,
  options: { afterId?: string; limit: number },
): Promise<InboundAddress[]> {
  return await db
    .select()
    .from(inboundAddresses)
    .where(
      and(
        eq(inboundAddresses.companyId, companyId),
        isNull(inboundAddresses.deletedAt),
        options.afterId ? lt(inboundAddresses.id, options.afterId) : undefined,
      ),
    )
    .orderBy(desc(inboundAddresses.id))
    .limit(options.limit);
}

/**
 * Enable or disable an address, or change the types it accepts. Imports already accepted
 * are not affected. With `revision`, only that revision is changed. A change to the
 * values the address already has is no change: no revision and no event. Null when the
 * address is deleted or is at another revision.
 */
export async function updateInboundAddress(
  id: string,
  changes: { enabled?: boolean; acceptedTypes?: string[] | null },
  revision?: number,
): Promise<InboundAddress | null> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(inboundAddresses)
      .where(
        and(
          eq(inboundAddresses.id, id),
          isNull(inboundAddresses.deletedAt),
          revision === undefined ? undefined : eq(inboundAddresses.revision, revision),
        ),
      )
      .for("update");
    if (!current) {
      return null;
    }
    const changed: typeof changes = {};
    if (changes.enabled !== undefined && changes.enabled !== current.enabled) {
      changed.enabled = changes.enabled;
    }
    if (changes.acceptedTypes !== undefined && JSON.stringify(changes.acceptedTypes) !== JSON.stringify(current.acceptedTypes)) {
      changed.acceptedTypes = changes.acceptedTypes;
    }
    if (Object.keys(changed).length === 0) {
      return current;
    }
    const [row] = await tx
      .update(inboundAddresses)
      .set({ ...changed, revision: sql`${inboundAddresses.revision} + 1`, updatedAt: sql`now()` })
      .where(eq(inboundAddresses.id, id))
      .returning();
    await publishInboundAddressChanged(row, tx);
    return row;
  });
}

/**
 * Stop receiving on an address. The row stays, so the address is never given to another
 * company. With `revision`, only that revision is deleted. False when nothing was deleted.
 */
export async function deleteInboundAddress(id: string, revision?: number): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(inboundAddresses)
      .set({
        enabled: false,
        deletedAt: sql`now()`,
        revision: sql`${inboundAddresses.revision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(inboundAddresses.id, id),
          isNull(inboundAddresses.deletedAt),
          revision === undefined ? undefined : eq(inboundAddresses.revision, revision),
        ),
      )
      .returning();
    if (row) {
      await publishInboundAddressDeleted(row, tx);
    }
    return !!row;
  });
}
