import {
  formatEntitlementMessage,
  getEffectiveEntitlement,
  registerEntitlement,
  type EffectiveEntitlement,
} from "@core/lib/entitlements";
import { getExtendedTeam } from "@peppol/data/teams";
import { PEPPOL_ENTITLEMENTS, type PeppolEntitlementId } from "@peppol/lib/entitlement-ids";

export { PEPPOL_ENTITLEMENTS, type PeppolEntitlementId } from "@peppol/lib/entitlement-ids";

// Which teams hold these rights is decided by the deployment's entitlement
// resolver, if it has one; this package only checks them. Playground teams test
// the product and are never restricted.

registerEntitlement({
  id: PEPPOL_ENTITLEMENTS.TRANSACTIONS,
  name: "Document exchange",
  description: "Send, generate and preview documents and file reports through the API",
});

registerEntitlement({
  id: PEPPOL_ENTITLEMENTS.INTEGRATIONS,
  name: "Integrations",
  description: "Connect and run integrations with external systems",
});

/**
 * The effective value of one of this package's entitlements for a team, with the
 * resolver's message addressed to the team. Playground teams always hold it.
 */
export async function checkPeppolEntitlement(
  team: { id: string; name: string; isPlayground?: boolean | null },
  entitlementId: PeppolEntitlementId
): Promise<EffectiveEntitlement> {
  if (team.isPlayground) {
    return { entitlementId, allowed: true, managed: false, message: null, actionUrl: null };
  }
  const entitlement = await getEffectiveEntitlement(team.id, entitlementId);
  return {
    ...entitlement,
    message: formatEntitlementMessage(entitlement.message, { teamName: team.name }),
  };
}

export async function checkPeppolEntitlementForTeamId(
  teamId: string,
  entitlementId: PeppolEntitlementId
): Promise<EffectiveEntitlement> {
  const team = await getExtendedTeam(teamId);
  if (!team) {
    return {
      entitlementId,
      allowed: false,
      managed: true,
      message: "Team not found",
      actionUrl: null,
    };
  }
  return checkPeppolEntitlement(team, entitlementId);
}
