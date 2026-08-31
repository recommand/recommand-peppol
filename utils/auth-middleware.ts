import { isMember } from "@core/data/teams";
import {
  requireAuth,
  requireTeamAccess,
  type AuthenticatedTeamContext,
  type AuthenticatedUserContext,
  type TeamAccessOptions,
} from "@core/lib/auth-middleware";
import { registerIntegrationSupportedAuthExtension } from "@directory/utils/auth-middleware";
import { verifySession, type SessionVerificationExtension } from "@core/lib/session";
import { getBillingProfile } from "@peppol/data/billing-profile";
import { getCompanyById, type Company } from "@peppol/data/companies";
import { verifyIntegrationJwt } from "@peppol/data/integrations/auth";
import { getExtendedTeam, type ExtendedTeam } from "@peppol/data/teams";
import { getActiveSubscription } from "@peppol/data/subscriptions";
import { isPlayground } from "@peppol/data/teams";
import { canUseIntegrations } from "@peppol/utils/plan-validation";
import { actionFailure } from "@recommand/lib/utils";
import { createMiddleware } from "hono/factory";

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
      return c.json(actionFailure("Unauthorized"), 401);
    }


    const companyId = c.req.param("companyId");
    if (!companyId) {
      return c.json(actionFailure("Company ID is required"), 400);
    }
    const company = await getCompanyById(companyId);
    if (!company) {
      return c.json(actionFailure("Company not found"), 404);
    }

    const contextTeamId = c.get("teamId");
    const user: { id: string; isAdmin: boolean } | null = c.get("user");
    if (contextTeamId) {
      // If the user is authenticated via an API key, ensure the API key belongs to the team
      // Admins bypass this check and can access any company
      if (!user?.isAdmin && contextTeamId !== company.teamId) {
        return c.json(actionFailure("Unauthorized"), 401);
      }
    } else {
      if (!user?.id) {
        return c.json(actionFailure("Unauthorized"), 401);
      }
      // If the user is not authenticated via an API key, ensure they are a member of the team
      // Admins bypass this check and can access any company
      if (!user.isAdmin && !(await isMember(user.id, company.teamId))) {
        return c.json(actionFailure("Unauthorized"), 401);
      }
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

export function requireValidSubscription() {
  return createMiddleware<AuthenticatedUserContext & AuthenticatedTeamContext & CompanyAccessContext>(
    async (c, next) => {
      const team = c.var.team;
      if (!team) {
        return c.json(actionFailure("Team not found"), 404);
      }

      // Ensure the team has a valid billing profile if it's not a playground team
      if (!team.isPlayground) {
        const billingProfile = await getBillingProfile(team.id);
        if (!billingProfile) {
          return c.json(
            actionFailure(
              `Team ${team.name} does not have a valid billing profile`
            ),
            401
          );
        }
        if(billingProfile.profileStanding === "pending" || billingProfile.profileStanding === "suspended") {
          return c.json(
            actionFailure(
              `Team ${team.name} does not have a valid billing profile. Your subscription is currently in a ${billingProfile.profileStanding} state. Ensure you have a valid payment mandate and your subscription is active. If you need help, please contact support@recommand.eu.`
            ),
            401
          );
        }
      }

      await next();
    }
  );
}

export const integrationSupportedAuthExtensions: SessionVerificationExtension[] = [
  // Also allow access if the user is authenticated via an integration JWT
  async (c) => {
    const authorizationHeader = c.req.header("Authorization")?.split(" ");
    if (!authorizationHeader || authorizationHeader.length !== 2) {
      return null;
    }
    const authorizationType = authorizationHeader[0];
    const encodedCredentials = authorizationHeader[1];
    if (authorizationType !== "Bearer" || !encodedCredentials) {
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

export function registerPeppolAuthExtensions() {
  for (const extension of integrationSupportedAuthExtensions) {
    registerIntegrationSupportedAuthExtension(extension);
  }
}

export function requireIntegrationSupportedAuth() {
  return requireAuth({
    extensions: integrationSupportedAuthExtensions,
  })
}

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

      const teamIsPlayground = await isPlayground(team.id);
      const subscription = await getActiveSubscription(team.id);

      if (!canUseIntegrations(teamIsPlayground, subscription)) {
        return c.json(
          actionFailure(
            "Integrations are only available on Starter, Professional, or Enterprise plans. Please upgrade your subscription to use integrations."
          ),
          403
        );
      }

      await next();
    }
  );
}

export function requireCompanyVerificationForStrictTeams() {
  return createMiddleware<CompanyAccessContext>(
    async (c, next) => {
      const team = c.var.team;
      let company = c.var.company;

      if (!team || !company) {
        return c.json(actionFailure("Team or company not found"), 404);
      }

      const verificationRequirements = team.verificationRequirements ?? "lax";

      if (verificationRequirements === "strict") {
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