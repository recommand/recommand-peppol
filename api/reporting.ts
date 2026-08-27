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
  buildFrenchSeller,
  submitArratechB2BiReport,
  submitArratechB2CReport,
} from "@peppol/data/at/fr-reporting";
import { getSendingCompanyIdentifier } from "@peppol/data/company-identifiers";
import { recordOutgoingDocument } from "@peppol/data/record-outgoing-document";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import {
  frenchB2BiReportSchema,
  getFrenchB2BiReportDocumentProfile,
  type FrenchB2BiReport,
} from "@peppol/utils/parsing/b2bi-reporting/france";
import {
  frenchB2CReportSchema,
  getFrenchB2CReportDocumentProfile,
  type FrenchB2CReport,
} from "@peppol/utils/parsing/b2c-reporting/france";
import type { ReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";

const server = new Server();

const frenchReportResponseSchema = z.object({
  id: z.string().openapi({
    description:
      "Identifier of the report. Keep it for support and future status checks. The report is also listed with your other documents.",
  }),
});

const referenceGuidance = `Choose a unique \`reference\` for every report. Reuse it when retrying the exact same request; this makes retries safe without creating a second filing. Reuse it as well, together with the optional \`action\` field, to correct or cancel a report you sent earlier: a correction or cancellation acts on the report that carries the same reference, while a new reference always files a new report.`;

const b2cRouteDescription = describeRoute({
  operationId: "submitFrenchB2CReport",
  summary: "Submit a French B2C report",
  tags: ["Reporting"],
  description: `Submit French daily sales or payment totals for transactions with private individuals. You do not need to create or submit a regulatory file yourself.

Use a sales report for the normal daily transaction totals, regardless of when customers pay. This endpoint accepts one sales summary per day and per category. The current integration supports taxable goods and taxable services.

Use a payment report only as an additional report for services using cash-basis VAT (\`TVA sur les encaissements\`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit the payment report for the day payment is received. Do not send payment reports for goods or for services where VAT becomes due when invoiced (\`TVA sur les débits\`).

${referenceGuidance}

A submitted report is recorded alongside your sent documents and counts towards your document quota.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchReportResponseSchema
    ),
    ...describeErrorResponse(400, "Invalid reporting data or company details"),
    ...describeErrorResponse(
      502,
      "The reporting service could not accept the report"
    ),
  },
});

const b2biRouteDescription = describeRoute({
  operationId: "submitFrenchB2BiReport",
  summary: "Submit a French cross-border report",
  tags: ["Reporting"],
  description: `Submit a French e-reporting declaration for an operation with a business established outside France. These invoices are not exchanged over the French e-invoicing network, so their data is reported to the French tax administration instead. You do not need to create or submit a regulatory file yourself.

Use an invoice report for a single cross-border invoice or credit note. Report every such document; the buyer must not be established in France.

Use a payment report for a payment received on a cross-border invoice. The invoice has to be reported before its payment can be, and the payment report refers back to it by \`invoiceNumber\`. Amounts on a payment report include VAT.

${referenceGuidance}

A submitted report is recorded alongside your sent documents and counts towards your document quota.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchReportResponseSchema
    ),
    ...describeErrorResponse(400, "Invalid reporting data or company details"),
    ...describeErrorResponse(
      502,
      "The reporting service could not accept the report"
    ),
  },
});

type FrenchReportingContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext
>;

type FrenchReportDocumentProfile = {
  type: ReportingDocumentTypeKey;
  docTypeId: string;
  processId: string;
};

/**
 * Files a French report with the reporting provider and records it as an outgoing
 * document. Every report type reaches the platform the same way; only the payload
 * that is submitted differs, which is what `submit` holds.
 *
 * Playground teams that are not on the test network never reach the provider, so
 * they get a simulated reference instead of a filing.
 */
async function fileFrenchReport({
  c,
  report,
  profile,
  submit,
}: {
  c: FrenchReportingContext;
  report: FrenchB2CReport | FrenchB2BiReport;
  profile: FrenchReportDocumentProfile;
  submit: (options: { useTestNetwork: boolean }) => Promise<{ flowId: string }>;
}) {
  const company = c.var.company;
  const isPlayground = c.var.team.isPlayground;
  const useTestNetwork = c.var.team.useTestNetwork ?? false;

  let externalReferenceId: string;
  if (isPlayground && !useTestNetwork) {
    externalReferenceId = "sim_" + ulid();
  } else {
    try {
      const result = await submit({ useTestNetwork });
      externalReferenceId = result.flowId;
    } catch (error) {
      console.error("Failed to submit French report:", error);
      await audit(c, {
        action: report.action,
        subsystem: "peppol.documents",
        outcome: "failed",
        objectType: "peppol.document",
        reasonCode: "submit_french_report_failed",
        metadata: {
          inputFormat: "json_api",
          companyId: company.id,
          country: "FR",
          documentType: profile.type,
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
      docTypeId: profile.docTypeId,
      processId: profile.processId,
      countryC1: company.country,
      type: profile.type,
      parsed: report,
      xml: null,
    },
    delivery: { kind: "reporting", externalReferenceId },
  });

  return c.json(actionSuccess({ id: transmittedDocument.id }));
}

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
  b2cRouteDescription,
  zodValidator("json", frenchB2CReportSchema),
  async (c: FrenchB2CReportingContext) => {
    const report = c.req.valid("json");
    const company = c.var.company;

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

    return fileFrenchReport({
      c,
      report,
      profile: getFrenchB2CReportDocumentProfile(report.type),
      submit: ({ useTestNetwork }) =>
        submitArratechB2CReport({ input: report, declarant, useTestNetwork }),
    });
  }
);

export type SubmitFrenchB2CReport = typeof _submitFrenchB2CReport;

type FrenchB2BiReportingContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof frenchB2BiReportSchema> };
    out: { json: z.infer<typeof frenchB2BiReportSchema> };
  }
>;

const _submitFrenchB2BiReport = server.post(
  "/:companyId/reporting/fr/b2bi",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  b2biRouteDescription,
  zodValidator("json", frenchB2BiReportSchema),
  async (c: FrenchB2BiReportingContext) => {
    const report = c.req.valid("json");
    const company = c.var.company;

    if (company.country !== "FR") {
      return c.json(
        actionFailure(
          "Cross-border reporting is currently available only for companies registered in France."
        ),
        400
      );
    }

    const declarant = buildFrenchDeclarant(company);
    const seller = buildFrenchSeller(company);
    if (!declarant || !seller) {
      return c.json(
        actionFailure(
          "The company needs a valid 9-digit French SIREN and a VAT number before a cross-border report can be submitted."
        ),
        400
      );
    }

    // Operations with a French buyer are exchanged over the French e-invoicing
    // network instead of being reported, so they do not belong here.
    if (report.type === "invoice" && report.buyer.country === "FR") {
      return c.json(
        actionFailure(
          "Cross-border reporting covers buyers established outside France. An invoice to a French buyer is exchanged over the e-invoicing network instead."
        ),
        400
      );
    }

    return fileFrenchReport({
      c,
      report,
      profile: getFrenchB2BiReportDocumentProfile(report.type),
      submit: ({ useTestNetwork }) =>
        submitArratechB2BiReport({
          input: report,
          declarant,
          seller,
          useTestNetwork,
        }),
    });
  }
);

export type SubmitFrenchB2BiReport = typeof _submitFrenchB2BiReport;

export default server;
