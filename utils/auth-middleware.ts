import { isMember } from "@core/data/teams";
import { audit } from "@core/lib/audit";
import {
  checkTeamAccess,
  getTeamHeader,
  refuseTeamMismatch,
  requireAuth,
  requireTeamAccess as requireCoreTeamAccess,
  TEAM_HEADER,
  withTeamHeader,
  type AuthenticatedTeamContext,
  type AuthenticatedUserContext,
  type TeamAccessOptions,
} from "@core/lib/auth-middleware";
import { presentsBearerToken, presentsOAuthAccessToken, setBearerChallenge } from "@core/lib/oauth/bearer";
import { hasRequestPermission, requirePermission as requireTeamPermission } from "@core/lib/permissions/permission-middleware";
import { verifySession, type SessionVerificationExtension } from "@core/lib/session";
import { getCompanyById, type Company } from "@peppol/data/companies";
import { getCustomerTeamId } from "@peppol/data/customers";
import { verifyIntegrationJwt } from "@peppol/data/integrations/auth";
import { getLabelTeamId } from "@peppol/data/labels";
import { getSupplierTeamId } from "@peppol/data/suppliers";
import { getExtendedTeam, type ExtendedTeam } from "@peppol/data/teams";
import { getTransmittedDocumentTeamId } from "@peppol/data/transmitted-documents";
import { getWebhookById } from "@peppol/data/webhooks";
import { checkPeppolEntitlement, checkPeppolEntitlementForTeamId, PEPPOL_ENTITLEMENTS } from "@peppol/lib/entitlements";
import { actionFailure } from "@recommand/lib/utils";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { requiresCompanyVerification } from "@peppol/utils/playground";

type InternalTokenContext = {
  Variables: {
    token: string;
  };
};

export function requireInternalToken() {
  return createMiddleware<InternalTokenContext>(async (c, next) => {
    const token = c.req.header("X-Internal-Token");
    if (!token || (token !== process.env.INTERNAL_TOKEN && token !== process.env.INTERNAL_TEST_TOKEN)) {
      return c.json(actionFailure("Unauthorized"), 401);
    }
    c.set("token", token);
    await next();
  });
}

export type CompanyAccessContext = {
  Variables: {
    company: Company;
    team: ExtendedTeam;
  };
};

type CompanyAccessOptions = {
  extensions?: SessionVerificationExtension[];
};

export function requireCompanyAccess(options: CompanyAccessOptions = {}) {
  return createMiddleware<
    AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext
  >(async (c, next) => {
    // Verify user's session
    const session = await verifySession(c, options.extensions);
    if (!session) {
      // Tells a client whose bearer token didn't authenticate it that the token is invalid
      setBearerChallenge(c, presentsBearerToken(c) ? { error: "invalid_token" } : {});

      return c.json(actionFailure("Unauthorized"), 401);
    }


    // The answer can depend on `Recommand-Team`, so caches keep the answers apart. Set before the
    // company is looked up, so a company that doesn't exist answers exactly like one in a team
    // the user isn't a member of.
    c.header("Vary", TEAM_HEADER, { append: true });

    const companyId = c.req.param("companyId");
    if (!companyId) {
      return c.json(actionFailure("Company ID is required"), 400);
    }
    const company = await getCompanyById(companyId);
    if (!company) {
      return c.json(actionFailure("Company not found"), 404);
    }

    const access = await checkTeamAccess(c, company.teamId);
    // Answered as Core's `requireTeamAccess` answers an OAuth grant: the user can grant
    // the client a team they're a member of on the consent screen, but not another team
    if (!access.allowed && c.get("grant")) {
      await audit(c, {
        action: "authorize",
        objectId: company.teamId,
        objectType: "core.team",
        outcome: "denied",
        reasonCode: access.reason,
        subsystem: "core.team_access",
      });
      // A company in a team the user isn't a member of answers like one that doesn't exist,
      // so a grant can't learn that it exists
      if (access.reason !== "not_in_grant") {
        return c.json(actionFailure("Company not found"), 404);
      }

      setBearerChallenge(c, { error: "insufficient_scope" });

      return c.json(actionFailure("This team isn't part of the OAuth grant"), 403);
    }

    if (!access.allowed) {
      return c.json(actionFailure("Unauthorized"), 401);
    }

    // The company decides the team, so a header naming another one is refused, never applied.
    // Only once the request may act in the company's team, so no one else learns which team it's in.
    const headerTeamId = getTeamHeader(c);
    if (headerTeamId && headerTeamId !== company.teamId) {
      return refuseTeamMismatch(c);
    }

    // Get team based on company
    const team = await getExtendedTeam(company.teamId);
    if (!team) {
      return c.json(actionFailure("Team not found"), 404);
    }

    // If there is a teamId param as well, ensure it matches the company's teamId
    const teamId = c.req.param("teamId");
    if (teamId && teamId !== company.teamId) {
      return c.json(actionFailure("Unauthorized"), 401);
    }

    c.set("team", team);
    c.set("company", company);

    await next();
  });
}

/**
 * Only a team that holds the document exchange entitlement may send, generate or
 * report. The entitlement resolver, when the deployment has one, decides who
 * holds it and what a team without it is told.
 */
export function requireTransactionEntitlement() {
  return createMiddleware<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext>(
    async (c, next) => {
      const team = c.var.team;
      if (!team) {
        return c.json(actionFailure("Team not found"), 404);
      }

      const entitlement = await checkPeppolEntitlement(team, PEPPOL_ENTITLEMENTS.TRANSACTIONS);
      if (!entitlement.allowed) {
        return c.json(actionFailure(entitlement.message ?? "This team cannot exchange documents"), 401);
      }

      await next();
    }
  );
}

/**
 * Only a team that holds the document access entitlement may read or change its
 * stored documents, sent or received, except for labelling them. Documents keep
 * arriving without it, and are there once the team holds it again.
 */
export function requireDocumentAccess() {
  return createMiddleware<AuthenticatedUserContext & AuthenticatedTeamContext>(
    async (c, next) => {
      const team = c.var.team;
      if (!team) {
        return c.json(actionFailure("Team not found"), 404);
      }

      const entitlement = await checkPeppolEntitlementForTeamId(team.id, PEPPOL_ENTITLEMENTS.DOCUMENT_ACCESS);
      if (!entitlement.allowed) {
        return c.json(actionFailure(entitlement.message ?? "This team cannot access its documents"), 403);
      }

      await next();
    }
  );
}

const integrationSupportedAuthExtensions: SessionVerificationExtension[] = [
  // Also allow access if the user is authenticated via an integration JWT
  async (c) => {
    const authorizationHeader = c.req.header("Authorization")?.split(" ");
    if (!authorizationHeader || authorizationHeader.length !== 2) {
      return null;
    }
    const authorizationType = authorizationHeader[0];
    const encodedCredentials = authorizationHeader[1];
    // An OAuth access token is verified by Core, after this extension
    if (authorizationType !== "Bearer" || !encodedCredentials || presentsOAuthAccessToken(c)) {
      return null;
    }
    try {
      const payload = await verifyIntegrationJwt(encodedCredentials);
      if (!payload) {
        return null;
      }
      // An integration JWT is neither a core installation nor a service
      // principal, so both stay null, exactly as for cookie and basic auth.
      return {
        userId: null,
        isAdmin: false,
        language: "en",
        apiKey: null,
        teamId: payload.teamId as string,
        installation: null,
        service: null,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
]

// Only integrationSupportedAuthExtensions authenticate as an extension without a user
const isIntegrationToken = (c: Context) => c.get("authenticationMethod") === "extension" && !c.get("user")?.id;

/**
 * Core's `requirePermission`, except that an integration token passes. It carries no user to hold
 * permissions: it acts for an integration the team set up, and keeps the access it has always had.
 */
export const requirePermission = (permissionId: string) => {
  const check = requireTeamPermission(permissionId);
  const middleware = createMiddleware<AuthenticatedUserContext>(async (c, next) => {
    if (isIntegrationToken(c)) {
      return next();
    }

    return check(c, next);
  });

  // Keeps the OpenAPI description the check carries
  return Object.assign(middleware, check);
};

/** Whether the request holds the team permission. An integration token holds them all, as `requirePermission` lets it through. */
export const holdsPermission = async <E extends AuthenticatedUserContext>(c: Context<E>, permissionId: string) =>
  isIntegrationToken(c) || hasRequestPermission(c, permissionId);

/**
 * `requirePermission` for the requests `applies` picks out; the others pass without it. It adds nothing
 * to the OpenAPI description, so the operation describes when it applies.
 */
export const requirePermissionWhen = (permissionId: string, applies: (c: Context) => Promise<boolean>) => {
  const check = requirePermission(permissionId);

  return createMiddleware<AuthenticatedUserContext>(async (c, next) => (await applies(c)) ? check(c, next) : next());
};

export function requireIntegrationSupportedAuth() {
  return requireAuth({
    extensions: integrationSupportedAuthExtensions,
  })
}

type ResourceTeamLookup = {
  find: (id: string) => Promise<string | undefined>;
  /** The answer for an ID that names nothing; absent where the ID can also be an external one. */
  notFound?: string;
  param: string;
};

/**
 * How to find the team of a resource a path names by its ID, for an OAuth grant that covers
 * several teams. A customer or supplier can also be named by its external ID, which only names
 * something within one team, so for those the client names the team in `Recommand-Team`. A label
 * comes last: on a document's or a supplier's labels, the team is that of the document or supplier.
 */
const resourceTeamLookups: ResourceTeamLookup[] = [
  {
    find: async (id) => (await getCompanyById(id))?.teamId,
    notFound: "Company not found",
    param: "companyId",
  },
  {
    find: getTransmittedDocumentTeamId,
    notFound: "Document not found",
    param: "documentId",
  },
  {
    find: getCustomerTeamId,
    param: "customerId",
  },
  {
    find: getSupplierTeamId,
    param: "supplierId",
  },
  {
    // Only a rule that is a webhook, so a webhook's path never finds the team of another rule
    find: async (id) => (await getWebhookById(id))?.teamId,
    notFound: "Webhook not found",
    param: "webhookId",
  },
  {
    find: getLabelTeamId,
    notFound: "Label not found",
    param: "labelId",
  },
];

// The team of the first resource the path names that one is found for. A resource in a team the
// user isn't a member of counts as not found, so a grant can't learn that it exists
const findResourceTeamId = async (c: Context): Promise<string | null> => {
  const teamIds = await Promise.all(
    resourceTeamLookups.map(({ find, param }) => {
      const id = c.req.param(param);

      return id ? find(id) : undefined;
    })
  );
  const teamId = teamIds.find(Boolean);
  const userId = c.get("user")?.id;
  if (!teamId || !userId || !(await isMember(userId, teamId))) {
    return null;
  }

  return teamId;
};

/**
 * Core's `requireTeamAccess`, which also finds the team of the resource a path names, such
 * as a company or a document, for an OAuth grant that covers several teams. A resource that
 * doesn't exist answers `404`, rather than asking the client to name a team.
 */
export const requireTeamAccess = (options: TeamAccessOptions = {}) => {
  const check = requireCoreTeamAccess({ findTeamId: findResourceTeamId, ...options });

  const middleware = createMiddleware<AuthenticatedUserContext & AuthenticatedTeamContext>(async (c, next) => {
    const response = await check(c, next);
    // With a resource in the path, `team_required` means findResourceTeamId found no such resource
    const notFound = resourceTeamLookups.find(({ notFound, param }) => notFound && c.req.param(param))?.notFound;
    if (response?.status === 400 && notFound && (await response.clone().json()).code === "team_required") {
      return c.json(actionFailure(notFound), 404);
    }

    return response;
  });

  return options.documentTeamHeader ? withTeamHeader(middleware) : middleware;
};

export function requireIntegrationSupportedTeamAccess(options: TeamAccessOptions = {}) {
  return requireTeamAccess({
    ...options,
    extensions: integrationSupportedAuthExtensions,
  });
}

export function requireIntegrationSupportedCompanyAccess() {
  return requireCompanyAccess({
    extensions: integrationSupportedAuthExtensions,
  });
}

export function requireIntegrationAccess() {
  return createMiddleware<AuthenticatedUserContext & AuthenticatedTeamContext>(
    async (c, next) => {
      const team = c.var.team;
      if (!team) {
        return c.json(actionFailure("Team not found"), 404);
      }

      const extendedTeam = await getExtendedTeam(team.id);
      const entitlement = await checkPeppolEntitlement(extendedTeam ?? team, PEPPOL_ENTITLEMENTS.INTEGRATIONS);
      if (!entitlement.allowed) {
        return c.json(actionFailure(entitlement.message ?? "This team cannot use integrations"), 403);
      }

      await next();
    }
  );
}

/**
 * Refuses a company that has to be verified and is not: every company of a strict
 * team, and a company on the French production network whatever its team's level
 * (see requiresCompanyVerification).
 */
export function requireCompanyVerificationForStrictTeams() {
  return createMiddleware<CompanyAccessContext>(
    async (c, next) => {
      const team = c.var.team;
      let company = c.var.company;

      if (!team || !company) {
        return c.json(actionFailure("Team or company not found"), 404);
      }

      if (
        requiresCompanyVerification({
          verificationRequirements: team.verificationRequirements,
          smpProvider: company.smpProvider,
          useTestNetwork: team.useTestNetwork,
        })
      ) {
        if (!company.isVerified) {
          return c.json(
            actionFailure(
              "Company must be verified before sending or receiving documents. Please verify your company first."
            ),
            403
          );
        }
      }

      await next();
    }
  );
}