import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
} from "@core/lib/api-docs";
import { audit } from "@core/lib/audit";
import {
  buildFrenchDeclarant,
  submitArratechB2CReport,
} from "@peppol/data/at/b2c-reporting";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { recordOutgoingDocument } from "@peppol/data/record-outgoing-document";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import {
  frenchB2CReportSchema,
  getFrenchB2CReportDocumentProfile,
} from "@peppol/utils/parsing/b2c-reporting/france";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";

const server = new Server();

const frenchB2CReportResponseSchema = z.object({
  id: z.string().openapi({
    description:
      "Identifier of the report. Keep it for support and future status checks. The report is also listed with your other documents.",
  }),
});

const routeDescription = describeRoute({
  operationId: "submitFrenchB2CReport",
  summary: "Submit a French B2C report",
  tags: ["Reporting"],
  description: `Submit French daily sales or payment totals for transactions with private individuals. You do not need to create or submit a regulatory file yourself.

Use a sales report for the normal daily transaction totals, regardless of when customers pay. This endpoint accepts one sales summary per day and per category. The current integration supports taxable goods and taxable services.

Use a payment report only as an additional report for services using cash-basis VAT (\`TVA sur les encaissements\`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit the payment report for the day payment is received. Do not send payment reports for goods or for services where VAT becomes due when invoiced (\`TVA sur les débits\`).

Choose a unique \`reference\` for every submission. Reuse it only when retrying the exact same request; this makes retries safe without creating a second filing. Use a new reference together with the optional \`action\` field when correcting or cancelling an earlier daily report.

A submitted report is recorded alongside your sent documents and counts towards your document quota.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchB2CReportResponseSchema
    ),
    ...describeErrorResponse(400, "Invalid reporting data or company details"),
    ...describeErrorResponse(
      502,
      "The reporting service could not accept the report"
    ),
  },
});

type FrenchB2CReportingContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof frenchB2CReportSchema> };
    out: { json: z.infer<typeof frenchB2CReportSchema> };
  }
>;

const _submitFrenchB2CReport = server.post(
  "/:companyId/reporting/fr/b2c",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  routeDescription,
  zodValidator("json", frenchB2CReportSchema),
  async (c: FrenchB2CReportingContext) => {
    const report = c.req.valid("json");
    const company = c.var.company;
    const isPlayground = c.var.team.isPlayground;
    const useTestNetwork = c.var.team.useTestNetwork ?? false;

    if (company.country !== "FR") {
      return c.json(
        actionFailure(
          "B2C reporting is currently available only for companies registered in France."
        ),
        400
      );
    }

    const declarant = buildFrenchDeclarant(company);
    if (!declarant) {
      return c.json(
        actionFailure(
          "The company needs a valid 9-digit French SIREN before a B2C report can be submitted."
        ),
        400
      );
    }

    let externalReferenceId: string;
    if (isPlayground && !useTestNetwork) {
      externalReferenceId = "sim_" + ulid();
    } else {
      try {
        const result = await submitArratechB2CReport({
          input: report,
          declarant,
          useTestNetwork,
        });
        externalReferenceId = result.flowId;
      } catch (error) {
        console.error("Failed to submit B2C report:", error);
        await audit(c, {
          action: report.action,
          subsystem: "peppol.documents",
          outcome: "failed",
          objectType: "peppol.document",
          reasonCode: "submit_b2c_report_failed",
          metadata: {
            inputFormat: "json_api",
            companyId: company.id,
            country: "FR",
            reportType: report.type,
            reference: report.reference,
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

    // The report is filed rather than transmitted, so it has no XML and no
    // recipient. The sending identifier still records which company filed it.
    const senderIdentifier = await getSendingCompanyIdentifier(company.id);
    const documentTypeProfile = getFrenchB2CReportDocumentProfile(report.type);
    const transmittedDocument = await recordOutgoingDocument({
      c,
      id: "doc_" + ulid(),
      teamId: c.var.team.id,
      company,
      isPlayground,
      inputFormat: "json_api",
      document: {
        senderId: `${senderIdentifier.scheme}:${senderIdentifier.identifier}`,
        receiverId: null,
        docTypeId: documentTypeProfile.docTypeId,
        processId: documentTypeProfile.processId,
        countryC1: company.country,
        type: documentTypeProfile.type,
        parsed: report,
        xml: null,
      },
      delivery: { kind: "reporting", externalReferenceId },
    });

    return c.json(actionSuccess({ id: transmittedDocument.id }));
  }
);

export type SubmitFrenchB2CReport = typeof _submitFrenchB2CReport;

export default server;
