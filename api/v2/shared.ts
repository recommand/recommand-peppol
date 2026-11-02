import { createHash } from "node:crypto";
import { isMember } from "@core/data/teams";
import { hasPrincipalPermission, type ActorPrincipal } from "@core/data/principal-permissions";
import { verifySession } from "@core/lib/session";
import { getCompanyById, type Company } from "@peppol/data/companies";
import { getExtendedTeam, type ExtendedTeam } from "@peppol/data/teams";
import { checkPeppolEntitlement, PEPPOL_ENTITLEMENTS } from "@peppol/lib/entitlements";
import type { Issue } from "@peppol/types/intake";
import { zodResolver } from "@recommand/lib/zod-validator";
import type { Context, MiddlewareHandler, ValidationTargets } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono-openapi/zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ulid } from "ulid";
import type { z } from "zod";
import { problemSchema } from "./schemas";

// The conventions of the v2 API: errors as RFC 9457 Problem Details, a request id on
// every response, cursor pagination, idempotency keys, and authorization that answers
// 404 for a resource the caller cannot see and 403 for an operation it may not do.

/** The base of the `type` URI of every problem. Provisional until the v2 release fixes it. */
export const PROBLEM_TYPE_BASE = "https://recommand.eu/problems/";

const TITLES: Record<string, string> = {
  invalid_request: "Invalid request",
  invalid_cursor: "Invalid cursor",
  idempotency_key_required: "Idempotency key required",
  idempotency_conflict: "Idempotency key reused",
  precondition_failed: "Precondition failed",
  unauthenticated: "Authentication required",
  forbidden: "Forbidden",
  not_found: "Not found",
  resource_deleted: "Resource deleted",
  import_in_progress: "Import in progress",
  payload_too_large: "Payload too large",
  unsupported_media_type: "Unsupported media type",
  unsupported_direction: "Unsupported direction",
  extraction_unsupported: "Extraction not supported",
  page_limit_exceeded: "Too many pages",
  label_not_found: "Label not found",
  service_unavailable: "Service unavailable",
  internal_error: "Internal error",
};

/** A v2 error. Thrown anywhere in a handler wrapped with `handle`, it becomes the response. */
export class ApiProblem extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly detail: string,
    readonly extensions: { issues?: Issue[]; context?: Record<string, unknown> } = {},
  ) {
    super(detail);
    this.name = "ApiProblem";
  }
}

function requestIdOf(c: Context): string {
  return (c.get("requestId" as never) as string | undefined) ?? `req_${ulid()}`;
}

export function problemResponse(c: Context, problem: ApiProblem): Response {
  return c.json(
    {
      type: `${PROBLEM_TYPE_BASE}${problem.code.replaceAll("_", "-")}`,
      title: TITLES[problem.code] ?? problem.code,
      status: problem.status,
      detail: problem.detail,
      code: problem.code,
      requestId: requestIdOf(c),
      ...problem.extensions,
    },
    problem.status,
    { "Content-Type": "application/problem+json" },
  );
}

/** Give the request its id, returned in `X-Request-Id`, and require an authenticated caller. */
export function v2Access(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const requestId = `req_${ulid()}`;
    c.set("requestId" as never, requestId as never);
    c.header("X-Request-Id", requestId);
    const session = await verifySession(c as never);
    if (!session) {
      return problemResponse(c, new ApiProblem(401, "unauthenticated", "Authenticate with an API key, a token or a session."));
    }
    await next();
  });
}

/** Turn a thrown ApiProblem into its response, and anything else into an internal error. */
export function handle<C extends Context>(handler: (c: C) => Promise<Response>) {
  return async (c: C): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof ApiProblem) {
        return problemResponse(c, error);
      }
      console.error(error);
      return problemResponse(c, new ApiProblem(500, "internal_error", "An unexpected error occurred."));
    }
  };
}

export function zodIssues(error: z.ZodError, base = ""): Issue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    pointer: `${base}/${issue.path.join("/")}`,
  }));
}

/** Validate part of the request, documented in the OpenAPI document; invalid input is a 400 problem. */
export function v2Validator<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return validator(target, schema, (result, c) => {
    if (!result.success) {
      return problemResponse(
        c,
        new ApiProblem(400, "invalid_request", "The request is not valid.", {
          issues: zodIssues(result.error as z.ZodError),
        }),
      );
    }
  });
}

function actorOf(c: Context): ActorPrincipal | null {
  const installation = c.get("installation" as never) as { id: string } | null | undefined;
  if (installation?.id) {
    return { type: "installation", installationId: installation.id };
  }
  const user = c.get("user" as never) as { id: string } | null | undefined;
  const apiKey = c.get("apiKey" as never) as { id: string } | null | undefined;
  if (apiKey?.id && user?.id) {
    return { type: "api_key", apiKeyId: apiKey.id, ownerUserId: user.id };
  }
  return user?.id ? { type: "user", userId: user.id } : null;
}

const notFound = (what: string) => new ApiProblem(404, "not_found", `The ${what} does not exist or is not accessible.`);

/**
 * Check that the caller may see the company and has the permission for the operation.
 * A company the caller cannot see is not found; a missing permission is forbidden.
 */
export async function authorizeCompany(
  c: Context,
  companyId: string,
  permissionId: string,
  what = "company",
): Promise<{ company: Company; team: ExtendedTeam }> {
  const company = await getCompanyById(companyId);
  if (!company) {
    throw notFound(what);
  }
  const team = await authorizeTeam(c, company.teamId, permissionId, what);
  return { company, team };
}

/**
 * Check that the caller may see the team and has the permission for the operation.
 * A team the caller cannot see is not found; a missing permission is forbidden.
 */
export async function authorizeTeam(
  c: Context,
  teamId: string,
  permissionId: string,
  what = "team",
): Promise<ExtendedTeam> {
  const user = c.get("user" as never) as { id: string; isAdmin: boolean } | null | undefined;
  const boundTeamId = credentialTeamId(c);
  const visible = user?.isAdmin
    ? true
    : boundTeamId
      ? boundTeamId === teamId
      : !!user?.id && (await isMember(user.id, teamId));
  if (!visible) {
    throw notFound(what);
  }
  const team = await getExtendedTeam(teamId);
  if (!team) {
    throw notFound(what);
  }
  c.set("team" as never, team as never);
  const actor = actorOf(c);
  if (!actor || !(await hasPrincipalPermission(actor, team.id, permissionId))) {
    throw new ApiProblem(403, "forbidden", `This operation needs the ${permissionId} permission.`);
  }
  return team;
}

/** The team a credential is bound to, such as the team of an API key; null for a user session. */
export function credentialTeamId(c: Context): string | null {
  return (c.get("teamId" as never) as string | null | undefined) ?? null;
}

/** Only a team that may exchange documents may create intake. */
export async function requireTransactions(team: ExtendedTeam) {
  const entitlement = await checkPeppolEntitlement(team, PEPPOL_ENTITLEMENTS.TRANSACTIONS);
  if (!entitlement.allowed) {
    throw new ApiProblem(403, "forbidden", entitlement.message ?? "This team cannot exchange documents.");
  }
}

export function deletedProblem(what: string, row: { deletedAt: Date | null; revision?: number }) {
  return new ApiProblem(410, "resource_deleted", `The ${what} was deleted.`, {
    context: { deletedAt: row.deletedAt?.toISOString(), reason: "deleted", revision: row.revision },
  });
}

// --- Validators ---------------------------------------------------------------

/**
 * The strong ETag of a resource whose representation changes only with its revision.
 * A tag is compared within one resource, so its revision is enough.
 */
export function etag(revision: number): string {
  return `"${revision}"`;
}

/**
 * Check a supplied If-Match against the current revision. Without the header the
 * operation goes ahead: the precondition is optional where this is used.
 */
export function checkIfMatch(c: Context, revision: number) {
  const header = c.req.header("If-Match");
  if (header === undefined) {
    return;
  }
  const tags = header.split(",").map((tag) => tag.trim());
  if (!tags.includes("*") && !tags.includes(etag(revision))) {
    throw new ApiProblem(412, "precondition_failed", "The resource changed since you read it. Read it again and retry.", {
      context: { revision },
    });
  }
}

// --- Pagination ---------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

function filterHash(filters: unknown) {
  return createHash("sha256").update(canonicalJson(filters)).digest("hex").slice(0, 16);
}

/** An opaque cursor: a position in the list, bound to the filters it was made with. */
export function encodeCursor(position: unknown, filters: unknown): string {
  return Buffer.from(JSON.stringify({ p: position, f: filterHash(filters) })).toString("base64url");
}

/** Read a cursor back; the position must match the schema of the list's sort key. */
export function decodeCursor<T>(cursor: string | undefined, filters: unknown, position: z.ZodType<T>): T | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { p: unknown; f: string };
    const parsed = position.safeParse(decoded.p);
    if (decoded.f === filterHash(filters) && parsed.success) {
      return parsed.data;
    }
  } catch {
    // Not a cursor of ours.
  }
  throw new ApiProblem(400, "invalid_cursor", "The cursor is not valid for this list and its filters.");
}

/** A page from rows fetched with one more than the limit: the extra row says another page exists. */
export function page<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  positionOf: (row: Row) => unknown,
  filters: unknown,
) {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data: data.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(positionOf(last), filters) : null,
  };
}

// --- Idempotency --------------------------------------------------------------

/**
 * How long a key is guaranteed to replay its command after the command is no longer
 * active. Keys stay with their resource after that; the guarantee is the minimum.
 */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** The header that tells until when the key of a command replays it. */
export function idempotencyExpiryHeader(activeUntil: Date): Record<string, string> {
  return { "Idempotency-Key-Expires-At": new Date(activeUntil.getTime() + IDEMPOTENCY_RETENTION_MS).toISOString() };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The fingerprint of a command: its normalised input, so a replay can be told from a conflict. */
export function requestHash(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function idempotencyKey(c: Context): string {
  const key = c.req.header("Idempotency-Key")?.trim();
  if (!key) {
    throw new ApiProblem(400, "idempotency_key_required", "Send an Idempotency-Key header with this request.");
  }
  if (key.length > 255) {
    throw new ApiProblem(400, "invalid_request", "The Idempotency-Key header is longer than 255 characters.");
  }
  return key;
}

/** Compare a stored command with a repeated one: the same input replays it, other input conflicts. */
export function assertSameRequest(stored: { requestHash: string | null }, hash: string) {
  if (stored.requestHash !== hash) {
    throw new ApiProblem(409, "idempotency_conflict", "This Idempotency-Key was used for a different request.");
  }
}

// --- OpenAPI ------------------------------------------------------------------

export const IDEMPOTENCY_KEY_PARAMETER = {
  in: "header" as const,
  name: "Idempotency-Key",
  required: true,
  description:
    "A key you choose for this command, unique per command within the company. Sending it again with the same request returns the response of the first request, with the header `Idempotency-Replayed: true`; with another request, it fails with `409 idempotency_conflict`. The response header `Idempotency-Key-Expires-At` tells until when the key is guaranteed to replay.",
  schema: { type: "string" as const, maxLength: 255 },
};

export const IDEMPOTENCY_EXPIRES_HEADER = {
  description: "Until when the Idempotency-Key is guaranteed to replay this response.",
  schema: { type: "string" as const, format: "date-time" },
};

export const IDEMPOTENCY_REPLAYED_HEADER = {
  description: "true when the response replays the response of an earlier request with the same key.",
  schema: { type: "string" as const, enum: ["true"] },
};

export const ETAG_HEADER = {
  description: "The strong validator of the returned representation, for If-Match.",
  schema: { type: "string" as const },
};

type HeaderObject = { description: string; schema: Record<string, unknown> };

export function jsonResponse(description: string, schema: z.ZodTypeAny, headers?: Record<string, HeaderObject>) {
  return { description, ...(headers ? { headers } : {}), content: { "application/json": { schema: zodResolver(schema) } } };
}

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  400: "The request is not valid",
  401: "The caller is not authenticated",
  403: "The caller may not do this",
  404: "The resource does not exist or is not accessible",
  409: "The request conflicts with the state of the resource",
  410: "The resource was deleted",
  412: "The If-Match header does not match the current revision",
  413: "The file is too large",
  415: "The file is not a PDF or XML document",
  422: "The request is valid but cannot be processed",
  503: "The service is temporarily unavailable",
};

/** The error responses of an operation, each a Problem Details document. */
export function problemResponses(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: PROBLEM_DESCRIPTIONS[status] ?? "Error",
        content: { "application/problem+json": { schema: zodResolver(problemSchema) } },
      },
    ]),
  );
}
