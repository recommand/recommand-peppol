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
  getFrenchReportingDeclarant,
  requestFrenchReportingDeclarant,
  resolveFrenchReportingEnvironment,
  type FrenchReportingDeclarant,
} from "@peppol/data/fr-reporting-declarants";
import {
  zodFrReportingDeclarantStates,
  zodFrReportingEnvironments,
  zodFrVatExigibilities,
  zodFrVatRegimes,
} from "@peppol/db/schema";
import {
  requireCompanyVerificationForStrictTeams,
  requireIntegrationSupportedCompanyAccess,
  requireValidSubscription,
  type CompanyAccessContext,
} from "@peppol/utils/auth-middleware";
import { UserFacingError } from "@peppol/utils/util";
import { Server, type Context } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { zodValidator } from "@recommand/lib/zod-validator";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import "zod-openapi/extend";

const server = new Server();

export const frenchReportingDeclarantResponse = z
  .object({
    environment: zodFrReportingEnvironments.openapi({
      description:
        "The reporting environment this registration belongs to. Teams on the test network are registered in `TEST`, all other teams in `PROD`.",
    }),
    siren: z.string().openapi({
      example: "123456789",
      description: "The SIREN the company reports under, derived from its enterprise number.",
    }),
    issuerName: z.string().openapi({
      description: "The legal name carried as the issuer on every report filed for the company.",
    }),
    vatRegime: zodFrVatRegimes.openapi({
      description:
        "The company's French VAT regime. It determines how often its reports are filed with the tax administration.",
    }),
    vatExigibility: zodFrVatExigibilities.openapi({
      description:
        "When VAT becomes due for the company. Payment reports are only accepted under `ENCAISSEMENTS`; under `DEBITS` they are out of scope.",
    }),
    enabled: z.boolean().openapi({
      description:
        "Whether reports are currently accepted. A suspended registration keeps its registered state but refuses reports with a 400 until support re-enables it.",
    }),
    state: zodFrReportingDeclarantStates.openapi({
      description:
        "`pending` while the registration is being completed, `registered` once reports can be submitted, `blocked` when the registration needs support.",
    }),
    simulated: z.boolean().openapi({
      description:
        "True for playground and test-network teams, whose registration and reports are simulated instead of filed.",
    }),
    lastError: z.string().nullable().openapi({
      description: "The reason the last registration attempt failed, if any.",
    }),
    registeredAt: z.string().nullable().openapi({
      description:
        "When the registration was accepted. The company's reporting periods run from this moment. Null while the state is still `pending`.",
    }),
    createdAt: z.string().openapi({
      description: "When the registration was first requested.",
    }),
    updatedAt: z.string().openapi({
      description:
        "When the registration last changed, including a background retry of a `pending` registration.",
    }),
  })
  .openapi({ ref: "FrenchReportingDeclarant", title: "French e-reporting registration" });

export function toFrenchReportingDeclarantResponse(declarant: FrenchReportingDeclarant) {
  return {
    environment: declarant.environment,
    siren: declarant.siren,
    issuerName: declarant.issuerName,
    vatRegime: declarant.vatRegime,
    vatExigibility: declarant.vatExigibility,
    enabled: declarant.enabled,
    state: declarant.state,
    simulated: declarant.simulated,
    lastError: declarant.lastError,
    registeredAt: declarant.registeredAt?.toISOString() ?? null,
    createdAt: declarant.createdAt.toISOString(),
    updatedAt: declarant.updatedAt.toISOString(),
  };
}

const registerFrenchReportingDeclarantBodySchema = z
  .object({
    vatRegime: zodFrVatRegimes.openapi({
      example: "REEL_NORMAL_MENSUEL",
      description:
        "The company's French VAT regime: `REEL_NORMAL_MENSUEL` (régime réel normal), `REEL_SIMPLIFIE` (régime réel simplifié) or `FRANCHISE_EN_BASE` (franchise en base de TVA). Changing it after registration can leave the current reporting period unfiled; contact support before changing it.",
    }),
    vatExigibility: zodFrVatExigibilities.openapi({
      example: "DEBITS",
      description:
        "When VAT becomes due: `ENCAISSEMENTS` (on payment, typical for services) or `DEBITS` (on invoicing, typical for goods). Payment reports can only be submitted under `ENCAISSEMENTS`.",
    }),
  })
  .openapi({ ref: "RegisterFrenchReportingDeclarant" });

type FrenchReportingDeclarantContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext
>;

const getRouteDescription = describeRoute({
  operationId: "getFrenchReportingDeclarant",
  summary: "Get the French e-reporting registration",
  tags: ["Reporting"],
  description:
    "Returns the company's French e-reporting registration, or `null` when the company has not been registered yet. Reports can be submitted once the state is `registered`.",
  responses: {
    ...describeSuccessResponseWithZod(
      "The registration, or null when there is none",
      z.object({ declarant: frenchReportingDeclarantResponse.nullable() }),
    ),
    ...describeErrorResponse(404, "Company not found"),
  },
});

const registerRouteDescription = describeRoute({
  operationId: "registerFrenchReportingDeclarant",
  summary: "Register a company for French e-reporting",
  tags: ["Reporting"],
  description: `Registers the company as a declarant for French e-reporting, so its B2C and cross-border reports can be filed with the French tax administration on its behalf. Registration is an explicit step: it starts the company's reporting periods, so only register companies that will actually submit reports.

The company must be registered in France with a valid SIREN or SIRET, and must be verified with a signed French mandate. The registration is usually completed immediately; when the state stays \`pending\`, it is retried in the background. A \`blocked\` state means support has to intervene, for example because the SIREN is already registered by another platform.

Calling this endpoint again updates the VAT regime and exigibility. Changing the regime mid-period can leave that period unfiled, so coordinate such a change with support.`,
  responses: {
    ...describeSuccessResponseWithZod(
      "The registration as it stands after this request",
      z.object({ declarant: frenchReportingDeclarantResponse }),
    ),
    ...describeValidationErrorResponse(
      "The company is not registered in France, has no valid SIREN or SIRET as enterprise number, is not verified, or was verified without a signed French mandate.",
    ),
    ...describeErrorResponse(404, "Company not found"),
    ...describeErrorResponse(500, "The registration could not be requested"),
  },
});

const _getFrenchReportingDeclarant = server.get(
  "/:companyId/reporting/fr/declarant",
  requireIntegrationSupportedCompanyAccess(),
  getRouteDescription,
  async (c: FrenchReportingDeclarantContext) => {
    const declarant = await getFrenchReportingDeclarant(
      c.var.company.id,
      resolveFrenchReportingEnvironment(c.var.team),
    );
    return c.json(
      actionSuccess({
        declarant: declarant ? toFrenchReportingDeclarantResponse(declarant) : null,
      }),
    );
  },
);

export type GetFrenchReportingDeclarant = typeof _getFrenchReportingDeclarant;

type RegisterFrenchReportingDeclarantContext = Context<
  AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext,
  string,
  {
    in: { json: z.input<typeof registerFrenchReportingDeclarantBodySchema> };
    out: { json: z.infer<typeof registerFrenchReportingDeclarantBodySchema> };
  }
>;

const _registerFrenchReportingDeclarant = server.put(
  "/:companyId/reporting/fr/declarant",
  requireIntegrationSupportedCompanyAccess(),
  requireValidSubscription(),
  requireCompanyVerificationForStrictTeams(),
  registerRouteDescription,
  zodValidator("json", registerFrenchReportingDeclarantBodySchema),
  async (c: RegisterFrenchReportingDeclarantContext) => {
    const { vatRegime, vatExigibility } = c.req.valid("json");
    const company = c.var.company;
    try {
      const declarant = await requestFrenchReportingDeclarant({
        company,
        team: c.var.team,
        vatRegime,
        vatExigibility,
      });
      await audit(c, {
        action: "update",
        subsystem: "peppol.companies",
        objectType: "peppol.company",
        objectId: company.id,
        after: {
          frenchReporting: {
            environment: declarant.environment,
            siren: declarant.siren,
            vatRegime: declarant.vatRegime,
            vatExigibility: declarant.vatExigibility,
            state: declarant.state,
            simulated: declarant.simulated,
          },
        },
        metadata: { reason: "french_reporting_declarant_registration" },
      });
      return c.json(actionSuccess({ declarant: toFrenchReportingDeclarantResponse(declarant) }));
    } catch (error) {
      if (error instanceof UserFacingError) {
        return c.json(actionFailure(error), 400);
      }
      console.error("Failed to register French reporting declarant:", error);
      return c.json(actionFailure("Could not register the company for e-reporting"), 500);
    }
  },
);

export type RegisterFrenchReportingDeclarant = typeof _registerFrenchReportingDeclarant;

export default server;
