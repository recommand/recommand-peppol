import type { Context } from "hono";
import type { z } from "zod";
import { getInboundAddress, type InboundAddress } from "@peppol/data/inbound-addresses";
import type { inboundAddressSchema } from "@peppol/api/v2/schemas";
import { ApiProblem, authorizeCompany, deletedProblem } from "@peppol/api/v2/shared";

export const TAGS = ["Inbound Email Addresses"];
export const COLLECTION_PATH = "/companies/:companyId/email/inbound-addresses";
export const ITEM_PATH = `${COLLECTION_PATH}/:addressId`;

export function toInboundAddress(row: InboundAddress): z.infer<typeof inboundAddressSchema> {
  return {
    id: row.id,
    revision: row.revision,
    companyId: row.companyId,
    address: row.address,
    enabled: row.enabled,
    // A disabled address reports that, whatever its provisioning state.
    status: row.enabled ? row.status : "disabled",
    acceptedTypes: row.acceptedTypes ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function inboundAddressLocation(row: Pick<InboundAddress, "companyId" | "id">) {
  return `/api/v2/companies/${row.companyId}/email/inbound-addresses/${row.id}`;
}

/** An address of a company the caller may access with the permission. */
export async function loadInboundAddress(
  c: Context,
  permissionId: string,
  options: { allowDeleted?: boolean } = {},
): Promise<InboundAddress> {
  const companyId = c.req.param("companyId")!;
  await authorizeCompany(c, companyId, permissionId);
  const row = await getInboundAddress(companyId, c.req.param("addressId")!);
  if (!row) {
    throw new ApiProblem(404, "not_found", "The inbound address does not exist or is not accessible.");
  }
  if (row.deletedAt && !options.allowDeleted) {
    throw deletedProblem("inbound address", row);
  }
  return row;
}
