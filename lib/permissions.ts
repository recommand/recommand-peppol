import { registerPermission } from "@core/lib/permissions";

registerPermission({
  id: "peppol.billing",
  name: "Billing",
  description:
    "Run billing operations: end billing cycles, retry failed payments, and set a team's subscription plan and rates",
  scope: "global",
  prerequisiteActorPermissionIds: [],
  hasAdminPrerequisite: true,
});
