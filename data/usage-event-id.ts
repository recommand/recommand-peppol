import { createHash } from "node:crypto";

export type UsageDirection = "incoming" | "outgoing";
export type UsageChannel = "peppol" | "email" | "reporting";

function hashAddress(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex").slice(0, 24);
}

/**
 * A stable id for the usage of one transmission, so recording it again (a retried
 * job, a replayed webhook, a run that resumes) finds the event already there
 * instead of charging it twice. An email is charged per recipient address, so its
 * address, hashed, is part of the key; `occurrence` separates an address listed
 * more than once in the same send.
 */
export function usageEventId({
  transmittedDocumentId,
  direction,
  channel,
  recipient,
  occurrence = 1,
}: {
  transmittedDocumentId: string;
  direction: UsageDirection;
  channel: UsageChannel;
  recipient?: string;
  occurrence?: number;
}): string {
  const parts = ["te", transmittedDocumentId, direction, channel];
  if (recipient !== undefined) parts.push(hashAddress(recipient));
  if (occurrence > 1) parts.push(String(occurrence));
  return parts.join("_");
}
