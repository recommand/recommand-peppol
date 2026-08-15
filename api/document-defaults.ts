import { Server, type Context } from "@recommand/lib/api";
import { describeRoute } from "hono-openapi";
import { zodValidator } from "@recommand/lib/zod-validator";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@recommand/db";
import { transmittedDocuments } from "@peppol/db/schema";
import {
  requireIntegrationSupportedCompanyAccess,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import {
  DocumentType,
  documentTypeSchema,
} from "@peppol/utils/parsing/send-document";
import type { ParsedOrUnknownDocumentType } from "@peppol/utils/type-repository/document-types/types";
import {
  extractDocumentNumberForType,
  extractLastUsedIban,
  incrementDocumentNumber,
} from "@peppol/utils/document-defaults";

const server = new Server();

const getDocumentDefaultsQuerySchema = z.object({
  documentType: documentTypeSchema,
});

type GetDocumentDefaultsContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { query: z.input<typeof getDocumentDefaultsQuerySchema> };
    out: { query: z.infer<typeof getDocumentDefaultsQuerySchema> };
  }
>;

const _getDocumentDefaults = server.get(
  "/:companyId/documentDefaults",
  requireIntegrationSupportedCompanyAccess(),
  describeRoute({ hide: true }),
  zodValidator("query", getDocumentDefaultsQuerySchema),
  async (c: GetDocumentDefaultsContext) => {
    try {
      const { documentType } = c.req.valid("query");

      const supportedType: ParsedOrUnknownDocumentType | null = (() => {
        if (documentType === DocumentType.INVOICE) return "invoice";
        if (documentType === DocumentType.CREDIT_NOTE) return "creditNote";
        if (documentType === DocumentType.SELF_BILLING_INVOICE)
          return "selfBillingInvoice";
        if (documentType === DocumentType.SELF_BILLING_CREDIT_NOTE)
          return "selfBillingCreditNote";
        if (documentType === DocumentType.MESSAGE_LEVEL_RESPONSE)
          return "messageLevelResponse";
        return null;
      })();

      if (!supportedType) {
        return c.json(
          actionSuccess({
            documentNumber: null,
            iban: null,
            basedOnTransmittedDocumentId: null,
          })
        );
      }

      const last = await db
        .select({
          id: transmittedDocuments.id,
          parsed: transmittedDocuments.parsed,
        })
        .from(transmittedDocuments)
        .where(
          and(
            eq(transmittedDocuments.teamId, c.var.team.id),
            eq(transmittedDocuments.companyId, c.var.company.id),
            eq(transmittedDocuments.direction, "outgoing"),
            eq(transmittedDocuments.type, supportedType)
          )
        )
        .orderBy(desc(transmittedDocuments.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!last) {
        return c.json(
          actionSuccess({
            documentNumber: null,
            iban: null,
            basedOnTransmittedDocumentId: null,
          })
        );
      }

      const lastNumber = extractDocumentNumberForType(
        last.parsed,
        supportedType
      );
      const suggestedNumber = lastNumber
        ? incrementDocumentNumber(lastNumber)
        : null;
      const iban = extractLastUsedIban(last.parsed);

      return c.json(
        actionSuccess({
          documentNumber: suggestedNumber,
          iban,
          basedOnTransmittedDocumentId: last.id,
        })
      );
    } catch {
      return c.json(actionFailure("Failed to fetch document defaults"), 500);
    }
  }
);

export type DocumentDefaults = typeof _getDocumentDefaults;
export default server;
