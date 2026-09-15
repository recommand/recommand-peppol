import type {
  AuthenticatedTeamContext,
  AuthenticatedUserContext,
} from "@core/lib/auth-middleware";
import {
  describeErrorResponse,
  describeSuccessResponseWithZod,
  describeValidationErrorResponse,
} from "@core/lib/api-docs";
import { audit } from "@core/lib/audit";
import {
  buildFrenchDeclarant,
  buildFrenchSeller,
  describeFrenchReportEvent,
  describeFrenchReportingConflict,
  FrenchReportingSubmissionError,
  submitArratechB2BiReport,
  submitArratechB2CReport,
  type FrenchReportingSubmissionResult,
} from "@peppol/data/at/fr-reporting";
import { getDefaultCompanyIdentifier } from "@peppol/data/company-identifiers";
import {
  getReadyFrenchReportingDeclarant,
  isFrenchReportingSimulated,
  resolveFrenchReportingEnvironment,
  type FrenchReportingDeclarant,
} from "@peppol/data/fr-reporting-declarants";
import {
  ensureFrenchReportingSubmissionRecord,
  findFrenchPaymentReportsForInvoice,
  recordFrenchReportingSubmission,
} from "@peppol/data/fr-reporting-submissions";
import { recordOutgoingDocument } from "@peppol/data/record-outgoing-document";
import { findOutgoingDocumentByExternalReference } from "@peppol/data/transmitted-documents";
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
import { assessFrenchReportDuplicate } from "@peppol/utils/parsing/fr-reporting/duplicates";
import { assessFrenchPaymentInstalment } from "@peppol/utils/parsing/fr-reporting/instalments";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import type { ReportingDocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { createHash } from "node:crypto";
import { describeRoute } from "hono-openapi";
import { ulid } from "ulid";
import { z } from "zod";

const server = new Server();

const frenchReportResponseSchema = z.object({
  id: z.string().openapi({
    description:
      "The identifier of the document this report was recorded as. Pass it to the get document endpoint to follow the report's `reporting` block until `final` is true.",
  }),
  duplicate: z.boolean().openapi({
    description:
      "True when this reference was already filed, in which case the identifier of the existing report is returned and nothing was filed again.",
  }),
  warning: z.string().optional().openapi({
    description:
      "Present only on a duplicate that is not a plain retry: the reference was already used for a report that differs from this request, so nothing was filed for this request. The text says what was found. A correction or a cancellation sent under the reference of the report it means to act on is the usual cause.",
  }),
});

const referenceGuidance = `Choose a new, unique \`reference\` for every report, including corrections and cancellations. Retrying the exact same request with the same reference is safe: it returns the report filed the first time instead of filing a second one. A correction or cancellation acts on the report identified by the data in the request, and carries the optional \`action\` field.

A report is matched on the declarant and on the data that identifies the operation, and never on the reference: an invoice report and its payments on the invoice number, a daily sales total on the day, category and currency, and a daily payment total on the day and currency. Neither the issue date nor the payment date is part of how an invoice or its payment is matched. A correction replaces the report it matches in full, so send the complete report rather than the fields that changed, and a cancellation carries the complete report as well.

Both are refused with a 409 once the filing for that period has been assembled, which happens after the period ends rather than on the last day itself, and can happen before the report shows as \`filed\`. From then on the data of that period is with the tax administration: a new report for that period can still be submitted and is carried by a corrective filing, but changing or withdrawing a report that is already filed is done by the reporting service on request. Contact support with the reference of the report on file and its period.

When the reference of an earlier report is reused, the earlier report is returned with \`duplicate: true\` and a \`warning\`, and nothing is filed: the correction or cancellation still has to be sent under a new reference.

Follow a report through the \`reporting\` block of its document. It is final once \`final\` is true: filed with outcome code \`300\`, superseded, or rejected. A report that shows as \`filed\` with an empty outcome code or \`500\` is still being processed by the tax administration.`;

const registrationGuidance = `The company must be registered for French e-reporting first, through \`PUT /:companyId/reporting/fr/declarant\`. Reports for playground and test-network teams are recorded but not filed.`;

const b2cRouteDescription = describeRoute({
  operationId: "submitFrenchB2CReport",
  summary: "Submit a French B2C report",
  tags: ["Reporting"],
  description: `Submit French daily sales or payment totals for transactions with private individuals. You do not need to create or submit a regulatory file yourself.

Use a sales report for the normal daily transaction totals, regardless of when customers pay. This endpoint accepts one sales summary per day, category and currency. The current integration supports taxable goods and taxable services.

Use a payment report only as an additional report for services using cash-basis VAT (\`TVA sur les encaissements\`), where VAT becomes due when the customer pays. Submit the sales report as usual, then submit the payment report for the day payment is received. Payment reports are only accepted for companies registered with VAT due on payment.

${registrationGuidance}

${referenceGuidance}

A submitted report is recorded alongside your sent documents and counts towards your document quota.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchReportResponseSchema
    ),
    ...describeValidationErrorResponse(
      "Invalid reporting data; the company is not registered for e-reporting, its registration is not yet registered, or it is suspended; the company is not registered in France or lacks the identifiers a report needs; a payment report was sent for a company whose VAT is due on invoicing; or the reporting service refused the report.",
    ),
    ...describeErrorResponse(
      409,
      "The report conflicts with what was filed before, or the filing for the period has already been assembled and the report on file can no longer be corrected or cancelled through the API",
    ),
    ...describeErrorResponse(
      502,
      "The reporting service could not accept the report; retry with the same reference"
    ),
  },
});

const b2biRouteDescription = describeRoute({
  operationId: "submitFrenchB2BiReport",
  summary: "Submit a French cross-border report",
  tags: ["Reporting"],
  description: `Submit a French e-reporting declaration for an operation with a business established outside France. These invoices are not exchanged over the French e-invoicing network, so their data is reported to the French tax administration instead. You do not need to create or submit a regulatory file yourself.

Use an invoice report for a single cross-border invoice or credit note. Report every such document; the buyer must not be established in France. Buyers in the European Union are identified by their VAT number, buyers elsewhere by their country and name.

Use a payment report for a payment received on a cross-border invoice. The invoice has to be reported before its payment can be, and the payment report refers back to it by \`invoiceNumber\`. Amounts on a payment report include VAT. Payment reports are only accepted for companies registered with VAT due on payment.

The reporting service keeps one payment report per invoice. A second payment report on the same invoice replaces the one on file rather than being added to it, so separate instalments on one invoice cannot be reported yet. A plain \`submit\` for an invoice that already has a payment report on file is refused with a 409 and nothing is filed; send \`action: "correct"\` under a new reference to replace the report on file deliberately, or \`action: "cancel"\` to withdraw it, after which a new payment report for the invoice can be submitted.

${registrationGuidance}

${referenceGuidance}

A submitted report is recorded alongside your sent documents and counts towards your document quota.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The report was accepted for processing",
      frenchReportResponseSchema
    ),
    ...describeValidationErrorResponse(
      "Invalid reporting data; the company is not registered for e-reporting, its registration is not yet registered, or it is suspended; the company is not registered in France or lacks the identifiers a report needs; a payment report was sent for a company whose VAT is due on invoicing; or the reporting service refused the report.",
    ),
    ...describeErrorResponse(
      409,
      "The report conflicts with what was filed before: a payment report is already on file for the invoice and this request is not a correction or cancellation, or the filing for the period has already been assembled and the report on file can no longer be corrected or cancelled through the API",
    ),
    ...describeErrorResponse(
      502,
      "The reporting service could not accept the report; retry with the same reference"
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
 * The reference a simulated filing gets. Derived from the company and the report's
 * own reference so that a retried simulated report finds its earlier document,
 * exactly like a real one does through the partner's idempotency.
 */
function simulatedReference(companyId: string, reference: string): string {
  const digest = createHash("sha256").update(`${companyId}\0${reference}`).digest("hex");
  return `sim_${digest.slice(0, 26)}`;
}

const PAYMENT_REPORT_TYPES: ReadonlySet<string> = new Set(["payments", "payment"]);

/**
 * Checks the report against the declarant it is filed under. Payment events only
 * exist for taxpayers whose VAT is due on payment; under the other regime the
 * partner would refuse them, so they are refused here with the reason.
 */
function rejectForDeclarant(
  report: FrenchB2CReport | FrenchB2BiReport,
  declarant: FrenchReportingDeclarant,
): string | null {
  if (PAYMENT_REPORT_TYPES.has(report.type) && declarant.vatExigibility === "DEBITS") {
    return "Payment reports only apply to companies whose VAT becomes due on payment (TVA sur les encaissements). This company is registered with VAT due on invoicing.";
  }
  return null;
}

function toFailureResponse(c: FrenchReportingContext, error: FrenchReportingSubmissionError) {
  switch (error.kind) {
    case "rejected":
      return c.json(actionFailure(`The report was refused: ${error.message}`), 400);
    case "unregistered":
      return c.json(
        actionFailure(
          `The company is not registered for French e-reporting, or its registration is suspended: ${error.message}`,
        ),
        400,
      );
    case "conflict":
      return c.json(actionFailure(describeFrenchReportingConflict(error).message), 409);
    default:
      return c.json(
        actionFailure(
          "The reporting service could not accept the report. Retry later with the same reference.",
        ),
        502,
      );
  }
}

/**
 * Files a French report with the reporting provider and records it as an outgoing
 * document. Every report type reaches the platform the same way; only the payload
 * that is submitted differs, which is what `submit` holds.
 *
 * A retry under a reference that was filed before ends up at the document that
 * filing produced: the provider answers a replayed reference with the original
 * flow id, and one document exists per flow id. Playground and test-network teams
 * never reach the provider and get a simulated reference derived the same way.
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
  submit: (options: {
    environment: FrenchReportingDeclarant["environment"];
  }) => Promise<FrenchReportingSubmissionResult>;
}) {
  const company = c.var.company;
  const team = c.var.team;
  const isPlayground = team.isPlayground;
  const environment = resolveFrenchReportingEnvironment(team);

  const declarant = await getReadyFrenchReportingDeclarant(company.id, environment);
  if (!declarant) {
    return c.json(
      actionFailure(
        "The company is not registered for French e-reporting yet. Register it first through PUT /:companyId/reporting/fr/declarant and wait until the registration is in the registered state.",
      ),
      400,
    );
  }
  const rejection = rejectForDeclarant(report, declarant);
  if (rejection) {
    return c.json(actionFailure(rejection), 400);
  }

  // A second payment report on an invoice would replace the one on file at the
  // reporting service rather than add to it. That is refused before anything is
  // filed unless the customer asked for the replacement; see the assessment.
  if (report.type === "payment") {
    const instalment = assessFrenchPaymentInstalment({
      earlier: await findFrenchPaymentReportsForInvoice(company.id, report.invoiceNumber),
      submitted: report,
    });
    if (instalment.refusal) {
      await audit(c, {
        action: report.action,
        subsystem: "peppol.documents",
        outcome: "failed",
        objectType: "peppol.document",
        reasonCode: "french_payment_report_would_replace",
        metadata: {
          inputFormat: "json_api",
          companyId: company.id,
          country: "FR",
          documentType: profile.type,
          reportType: report.type,
          reference: report.reference,
          invoiceNumber: report.invoiceNumber,
        },
      });
      return c.json(actionFailure(instalment.refusal), 409);
    }
  }

  const simulated = isFrenchReportingSimulated(team);
  let externalReferenceId: string;
  let duplicate = false;
  let submission: FrenchReportingSubmissionResult | null = null;
  if (simulated) {
    externalReferenceId = simulatedReference(company.id, report.reference);
  } else {
    try {
      submission = await submit({ environment });
      externalReferenceId = submission.flowId;
      duplicate = submission.duplicate;
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
          providerStatus: error instanceof FrenchReportingSubmissionError ? error.status : null,
          providerCode: error instanceof FrenchReportingSubmissionError ? error.code : null,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (error instanceof FrenchReportingSubmissionError) {
        return toFailureResponse(c, error);
      }
      return c.json(
        actionFailure(
          "The reporting service could not accept the report. Retry later with the same reference.",
        ),
        502,
      );
    }
  }

  if (submission?.unknownReportingStatus) {
    console.warn(
      `French report ${externalReferenceId} was accepted with reporting status "${submission.unknownReportingStatus}", which this integration does not know`,
    );
  }

  const existing = await findOutgoingDocumentByExternalReference(
    company.id,
    externalReferenceId,
  );
  if (existing) {
    // The reference was used before. Two things can be true of the report on file: it
    // may be the one this request is retrying, or it may be a different report whose
    // reference was reused, in which case nothing was filed for this request. The
    // stored report says which.
    const assessment = assessFrenchReportDuplicate({
      stored: existing.parsed,
      submitted: report,
    });
    if (assessment.kind !== "retry") {
      console.warn(
        `French report reference ${report.reference} for company ${company.id} resolved to an earlier report (${assessment.kind})`,
      );
    }

    // A report filed without its record here is never polled, so the retry that lands
    // on the existing document is where the missing record is rebuilt.
    await ensureFrenchReportingSubmissionRecord({
      transmittedDocumentId: existing.id,
      storedReport: existing.parsed,
      declarantId: declarant.id,
      teamId: team.id,
      companyId: company.id,
      environment,
      flowId: externalReferenceId,
      simulated,
      ledgerStatus: submission?.status ?? null,
      reportingStatus: submission?.reportingStatus ?? null,
    });

    return c.json(
      actionSuccess({
        id: existing.id,
        duplicate: true,
        ...(assessment.warning ? { warning: assessment.warning } : {}),
      }),
    );
  }

  // The report is filed rather than transmitted, so it has no XML, no recipient and
  // no transport sender. The company's default identifier records which company
  // filed it.
  const senderIdentifier = await getDefaultCompanyIdentifier(company.id);
  const transmittedDocument = await recordOutgoingDocument({
    c,
    id: "doc_" + ulid(),
    teamId: team.id,
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

  // The filing's own record, which the status worker follows until the tax
  // administration has ruled on it. Recorded after the document so it can point
  // at it; a failure here must not fail a report that was filed and recorded.
  try {
    await recordFrenchReportingSubmission({
      transmittedDocumentId: transmittedDocument.id,
      declarantId: declarant.id,
      teamId: team.id,
      companyId: company.id,
      environment,
      flowId: externalReferenceId,
      reference: report.reference,
      ...describeFrenchReportEvent(report),
      simulated,
      ledgerStatus: submission?.status ?? null,
      reportingStatus: submission?.reportingStatus ?? null,
    });
  } catch (error) {
    console.error("Failed to record French reporting submission:", error);
    // The report is filed and its document exists, but nothing follows it yet. A retry
    // of the same reference repairs this; support is told in case none comes.
    sendSystemAlert(
      "French Reporting Record Not Written",
      `E-reporting event ${externalReferenceId} (company ${company.id}) was filed and recorded as document ${transmittedDocument.id}, but its follow-up record could not be written, so its status is not being polled. A retry under the same reference restores it.`,
      "error",
    );
  }

  return c.json(actionSuccess({ id: transmittedDocument.id, duplicate }));
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
          "The company needs a valid French SIREN or SIRET as enterprise number before a B2C report can be submitted."
        ),
        400
      );
    }

    return fileFrenchReport({
      c,
      report,
      profile: getFrenchB2CReportDocumentProfile(report.type),
      submit: ({ environment }) =>
        submitArratechB2CReport({ input: report, declarant, environment }),
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
          "The company needs a valid French SIREN or SIRET and a VAT number before a cross-border report can be submitted."
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
      submit: ({ environment }) =>
        submitArratechB2BiReport({
          input: report,
          declarant,
          seller,
          environment,
        }),
    });
  }
);

export type SubmitFrenchB2BiReport = typeof _submitFrenchB2BiReport;

export default server;
