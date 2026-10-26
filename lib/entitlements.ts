import { getExtendedTeam } from "@peppol/data/teams";
import { PEPPOL_ENTITLEMENTS, type PeppolEntitlementId } from "@peppol/lib/entitlement-ids";

export { PEPPOL_ENTITLEMENTS, type PeppolEntitlementId } from "@peppol/lib/entitlement-ids";

/**
 * Entitlements are the commercial rights a team has, as opposed to permissions,
 * which decide what a user may do inside a team. This package enforces them but
 * does not decide them: a package that knows the team's commercial state
 * registers a resolver when the server starts, and every check asks it, in
 * process. Without a resolver every team holds every entitlement, which is how
 * the package runs on its own. Playground teams are never restricted.
 *
 * A resolver that fails makes the check fail; it is never read as a grant. The
 * registering package must do so during its initialization, which the server
 * completes before it takes requests, so a failed initialization stops the
 * server instead of leaving it to run without restrictions.
 */

export type EntitlementDecision = {
  allowed: boolean;
  /** Shown when the entitlement is withheld. May contain `{teamName}`. */
  message?: string | null;
  /** Where the team can resolve it. */
  actionUrl?: string | null;
};

export type EntitlementResolver = (
  teamId: string,
  entitlementId: PeppolEntitlementId,
  at: Date
) => Promise<EntitlementDecision>;

export type EffectiveEntitlement = {
  entitlementId: PeppolEntitlementId;
  allowed: boolean;
  /** False when no resolver decides it, such as for a playground. */
  managed: boolean;
  message: string | null;
  actionUrl: string | null;
};

let resolver: EntitlementResolver | null = null;

export function registerEntitlementResolver(next: EntitlementResolver) {
  if (resolver) {
    throw new Error("An entitlement resolver is already registered");
  }
  resolver = next;
}

/** For tests: forget the registered resolver. */
export function clearEntitlementResolver() {
  resolver = null;
}

/**
 * The effective value of an entitlement for a team at `at` (default now), with
 * the message addressed to the team by name.
 */
export async function checkPeppolEntitlement(
  team: { id: string; name: string; isPlayground?: boolean | null },
  entitlementId: PeppolEntitlementId,
  at: Date = new Date()
): Promise<EffectiveEntitlement> {
  if (team.isPlayground || !resolver) {
    return { entitlementId, allowed: true, managed: false, message: null, actionUrl: null };
  }
  const decision = await resolver(team.id, entitlementId, at);
  if (decision.allowed) {
    return { entitlementId, allowed: true, managed: true, message: null, actionUrl: null };
  }
  return {
    entitlementId,
    allowed: false,
    managed: true,
    message: decision.message?.replaceAll("{teamName}", team.name) ?? null,
    actionUrl: decision.actionUrl ?? null,
  };
}

export async function checkPeppolEntitlementForTeamId(
  teamId: string,
  entitlementId: PeppolEntitlementId
): Promise<EffectiveEntitlement> {
  const team = await getExtendedTeam(teamId);
  if (!team) {
    return { entitlementId, allowed: false, managed: true, message: "Team not found", actionUrl: null };
  }
  return checkPeppolEntitlement(team, entitlementId);
}

/** Every entitlement this package enforces, for a team. */
export async function checkAllPeppolEntitlements(
  team: { id: string; name: string; isPlayground?: boolean | null }
): Promise<EffectiveEntitlement[]> {
  return await Promise.all(
    Object.values(PEPPOL_ENTITLEMENTS).map((entitlementId) => checkPeppolEntitlement(team, entitlementId))
  );
}
