import { Server } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import "zod-openapi/extend";
import {
  createInboundAddress,
  deleteInboundAddress,
  findInboundAddressByIdempotencyKey,
  type InboundAddress,
  listInboundAddresses,
  updateInboundAddress,
} from "@peppol/data/inbound-addresses";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";
import {
  inboundAddressPageSchema,
  inboundAddressSchema,
  intakeDocumentTypeSchema,
  paginationQuerySchema,
} from "@peppol/api/v2/schemas";
import {
  ApiProblem,
  assertSameRequest,
  authorizeCompany,
  checkIfMatch,
  decodeCursor,
  deletedProblem,
  ETAG_HEADER,
  etag,
  handle,
  IDEMPOTENCY_EXPIRES_HEADER,
  IDEMPOTENCY_KEY_PARAMETER,
  IDEMPOTENCY_REPLAYED_HEADER,
  idempotencyExpiryHeader,
  idempotencyKey,
  jsonResponse,
  page,
  problemResponses,
  requestHash,
  requireTransactions,
  v2Access,
  v2Validator,
} from "@peppol/api/v2/shared";
import { isUniqueViolation } from "@peppol/utils/db-errors";
import type { Context } from "hono";
import {
  COLLECTION_PATH,
  inboundAddressLocation,
  ITEM_PATH,
  loadInboundAddress,
  TAGS,
  toInboundAddress,
} from "./shared";

const server = new Server();

const acceptedTypesSchema = z
  .array(intakeDocumentTypeSchema)
  .min(1)
  .nullable()
  .openapi({ description: "The document types to accept; null accepts every supported type." });

const createSchema = z
  .object({
    enabled: z.boolean().default(true).openapi({ description: "Whether the address receives email. Default true." }),
    acceptedTypes: acceptedTypesSchema.default(null),
  })
  .strict();

const updateSchema = z
  .object({
    enabled: z.boolean().optional().openapi({ description: "Whether the address receives email." }),
    acceptedTypes: acceptedTypesSchema.optional(),
  })
  .strict()
  .refine((value) => value.enabled !== undefined || value.acceptedTypes !== undefined, "Change enabled, acceptedTypes or both.");

const normalizeTypes = (types: string[] | null) => (types ? [...new Set(types)].sort() : null);

const IF_MATCH_PARAMETER = {
  in: "header" as const,
  name: "If-Match",
  required: false,
  description: "The ETag of the address as you read it. When the address changed since, the request fails with 412 precondition_failed.",
  schema: { type: "string" as const },
};

const changed = () =>
  new ApiProblem(412, "precondition_failed", "The address changed since you read it. Read it again and retry.");

server.get(
  COLLECTION_PATH,
  v2Access(),
  describeRoute({
    operationId: "listInboundAddresses",
    summary: "List inbound email addresses",
    description: "The email addresses that receive documents for the company, newest first (in descending order of their ids, which follow the creation order).",
    tags: TAGS,
    responses: {
      200: jsonResponse("A page of inbound addresses", inboundAddressPageSchema),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  v2Validator("query", paginationQuerySchema),
  handle(async (c) => {
    const companyId = c.req.param("companyId")!;
    await authorizeCompany(c, companyId, PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_READ);
    const query = c.req.valid("query" as never) as z.infer<typeof paginationQuerySchema>;
    const filters = { companyId };
    const afterId = decodeCursor(query.cursor, filters, z.string());
    const rows = await listInboundAddresses(companyId, { afterId, limit: query.limit + 1 });
    return c.json(page(rows, query.limit, toInboundAddress, (row) => row.id, filters));
  }),
);

/** The headers of the response that created an address, the same when it is replayed. */
function createdHeaders(row: InboundAddress, body: { revision: number }) {
  return {
    Location: inboundAddressLocation(row),
    ETag: etag(body.revision),
    ...idempotencyExpiryHeader(row.createdAt),
  };
}

/** Answer a repeated command with the response that created the address. A deleted address stays deleted. */
async function replay(c: Context, row: InboundAddress, hash: string) {
  assertSameRequest(row, hash);
  if (row.deletedAt) {
    throw deletedProblem("inbound address", row);
  }
  const body = (row.idempotencyResponse as ReturnType<typeof toInboundAddress> | null) ?? toInboundAddress(row);
  return c.json(body, 202, { ...createdHeaders(row, body), "Idempotency-Replayed": "true" });
}

server.post(
  COLLECTION_PATH,
  v2Access(),
  describeRoute({
    operationId: "createInboundAddress",
    summary: "Create an inbound email address",
    description:
      "Give the company an email address on the Recommand inbound domain. The PDF and XML attachments of every email sent to it are imported for the company. The address is active at once.",
    tags: TAGS,
    parameters: [IDEMPOTENCY_KEY_PARAMETER],
    responses: {
      202: jsonResponse("The address. Its URL is in the Location header.", inboundAddressSchema, {
        Location: { description: "The URL of the address.", schema: { type: "string" } },
        ETag: ETAG_HEADER,
        "Idempotency-Key-Expires-At": IDEMPOTENCY_EXPIRES_HEADER,
        "Idempotency-Replayed": IDEMPOTENCY_REPLAYED_HEADER,
      }),
      ...problemResponses(400, 401, 403, 404, 409, 410),
    },
  }),
  v2Validator("json", createSchema),
  handle(async (c) => {
    const key = idempotencyKey(c);
    const companyId = c.req.param("companyId")!;
    const { team } = await authorizeCompany(c, companyId, PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_MANAGE);
    const body = c.req.valid("json" as never) as z.infer<typeof createSchema>;
    const acceptedTypes = normalizeTypes(body.acceptedTypes);
    const hash = requestHash({ companyId, enabled: body.enabled, acceptedTypes });
    const existing = await findInboundAddressByIdempotencyKey(companyId, key);
    if (existing) {
      return await replay(c, existing, hash);
    }
    await requireTransactions(team);
    let row: InboundAddress;
    try {
      row = await createInboundAddress(
        {
          teamId: team.id,
          companyId,
          enabled: body.enabled,
          acceptedTypes,
          idempotencyKey: key,
          requestHash: hash,
        },
        toInboundAddress,
      );
    } catch (error) {
      const concurrent = isUniqueViolation(error) ? await findInboundAddressByIdempotencyKey(companyId, key) : null;
      if (concurrent) {
        return await replay(c, concurrent, hash);
      }
      throw error;
    }
    const created = toInboundAddress(row);
    return c.json(created, 202, createdHeaders(row, created));
  }),
);

server.get(
  ITEM_PATH,
  v2Access(),
  describeRoute({
    operationId: "getInboundAddress",
    summary: "Get an inbound email address",
    tags: TAGS,
    responses: {
      200: jsonResponse("The address", inboundAddressSchema, { ETag: ETAG_HEADER }),
      ...problemResponses(401, 403, 404, 410),
    },
  }),
  handle(async (c) => {
    const row = await loadInboundAddress(c, PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_READ);
    return c.json(toInboundAddress(row), 200, { ETag: etag(row.revision) });
  }),
);

server.patch(
  ITEM_PATH,
  v2Access(),
  describeRoute({
    operationId: "updateInboundAddress",
    summary: "Update an inbound email address",
    description:
      "Enable or disable the address, or change the document types it accepts. A disabled address refuses new email; imports it already accepted finish. The address itself never changes. A request that changes nothing answers the current address, with no new revision and no event.",
    tags: TAGS,
    parameters: [IF_MATCH_PARAMETER],
    responses: {
      200: jsonResponse("The updated address", inboundAddressSchema, { ETag: ETAG_HEADER }),
      ...problemResponses(400, 401, 403, 404, 410, 412),
    },
  }),
  v2Validator("json", updateSchema),
  handle(async (c) => {
    const row = await loadInboundAddress(c, PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_MANAGE);
    checkIfMatch(c, row.revision);
    const body = c.req.valid("json" as never) as z.infer<typeof updateSchema>;
    const updated = await updateInboundAddress(
      row.id,
      {
        enabled: body.enabled,
        acceptedTypes: body.acceptedTypes === undefined ? undefined : normalizeTypes(body.acceptedTypes),
      },
      c.req.header("If-Match") === undefined ? undefined : row.revision,
    );
    if (!updated) {
      throw changed();
    }
    return c.json(toInboundAddress(updated), 200, { ETag: etag(updated.revision) });
  }),
);

server.delete(
  ITEM_PATH,
  v2Access(),
  describeRoute({
    operationId: "deleteInboundAddress",
    summary: "Delete an inbound email address",
    description:
      "Stop receiving email on the address at once. Its imports stay. The address is never given to another company. The deletion is complete when the response arrives, and deleting a deleted address succeeds.",
    tags: TAGS,
    parameters: [IF_MATCH_PARAMETER],
    responses: {
      204: { description: "The address is deleted" },
      ...problemResponses(401, 403, 404, 412),
    },
  }),
  handle(async (c) => {
    const row = await loadInboundAddress(c, PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_MANAGE, { allowDeleted: true });
    if (row.deletedAt) {
      return c.body(null, 204);
    }
    checkIfMatch(c, row.revision);
    const deleted = await deleteInboundAddress(row.id, c.req.header("If-Match") === undefined ? undefined : row.revision);
    if (!deleted && c.req.header("If-Match") !== undefined) {
      throw changed();
    }
    return c.body(null, 204);
  }),
);

export default server;
