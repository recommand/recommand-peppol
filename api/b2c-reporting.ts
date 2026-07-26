import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { audit } from "@core/lib/audit";
import { submitArratechB2cReport } from "@peppol/data/at/b2c-reporting";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import { frenchB2cReportSchema } from "@peppol/utils/parsing/b2c-reporting/france";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const server = new Server();

const frenchB2cReportResponseSchema = z.object({
  id: z.string().openapi({
    description:
      "Identifier assigned to this report. Keep it for support and future status checks.",
  }),
});

const routeDescription = describeRoute({
  operationId: "submitFrenchB2CReport",
  summary: "Submit a French B2C report",
  tags: ["Reporting"],
  description: `Submit French daily sales or payment totals for transactions with private individuals. You do not need to create or submit a regulatory file yourself.

Use a sales report for the normal daily transaction totals, regardless of when customers pay. This endpoint accepts one sales summary per day and per category. The current integration supports taxable goods and taxable services; other French sales categories are not yet supported.

Use a payment report only as an additional report for services using cash-basis VAT (\`TVA sur les encaissements\`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit the payment report for the day payment is received. Do not send payment reports for goods or for services where VAT becomes due when invoiced (\`TVA sur les débits\`).

Choose a unique \`reference\` for every submission. Reuse it only when retrying the exact same request; this makes retries safe without creating a second filing. Use a new reference together with the optional \`action\` field when correcting or cancelling an earlier daily report.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchB2cReportResponseSchema
    ),
    ...describeErrorResponse(400, "Invalid reporting data or company details"),
    ...describeErrorResponse(502, "The reporting service could not accept the report"),
  },
});

type B2cReportingContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof frenchB2cReportSchema> };
    out: { json: z.infer<typeof frenchB2cReportSchema> };
  }
>;

function getFrenchSiren({
  enterpriseNumber,
  vatNumber,
}: {
  enterpriseNumber: string | null;
  vatNumber: string | null;
}): string | null {
  const normalizedEnterpriseNumber = enterpriseNumber?.replace(/\s/g, "");
  if (normalizedEnterpriseNumber && /^\d{9}$/.test(normalizedEnterpriseNumber)) {
    return normalizedEnterpriseNumber;
  }

  const normalizedVatNumber = vatNumber?.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const vatNumberMatch = normalizedVatNumber?.match(/^FR[A-Z0-9]{2}(\d{9})$/);
  return vatNumberMatch?.[1] ?? null;
}

const _submitB2cReport = server.post(
  "/:companyId/reporting/france/b2c",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  routeDescription,
  zodValidator("json", frenchB2cReportSchema),
  async (c: B2cReportingContext) => {
    const input = c.req.valid("json");
    const company = c.var.company;

    if (company.country !== "FR") {
      return c.json(
        actionFailure(
          "B2C reporting is currently available only for companies registered in France."
        ),
        400
      );
    }

    const siren = getFrenchSiren(company);
    if (!siren) {
      return c.json(
        actionFailure(
          "The company needs a valid 9-digit French SIREN before a B2C report can be submitted."
        ),
        400
      );
    }

    try {
      const result = await submitArratechB2cReport({
        input,
        declarant: {
          siren,
          name: company.name,
        },
        useTestNetwork: c.var.team.useTestNetwork ?? false,
      });

      await audit(c, {
        action: input.action,
        subsystem: "peppol.b2c_reporting",
        objectType: "peppol.b2c_report",
        objectId: result.flowId,
        after: {
          companyId: company.id,
          country: "FR",
          reportType: input.type,
        },
        metadata: {
          reference: input.reference,
        },
      });

      return c.json(actionSuccess({ id: result.flowId }));
    } catch (error) {
      console.error("Failed to submit B2C report:", error);
      await audit(c, {
        action: input.action,
        subsystem: "peppol.b2c_reporting",
        outcome: "failed",
        objectType: "peppol.b2c_report",
        reasonCode: "submit_b2c_report_failed",
        metadata: {
          companyId: company.id,
          country: "FR",
          reportType: input.type,
          reference: input.reference,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return c.json(
        actionFailure(
          "The reporting service could not accept the report. Please try again later."
        ),
        502
      );
    }
  }
);

export type SubmitB2cReport = typeof _submitB2cReport;

export default server;
