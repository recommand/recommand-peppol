import { registerPermission } from "@core/lib/permissions";

registerPermission({
  id: "peppol.billing",
  name: "Billing",
  description:
    "Run billing operations: end billing cycles and retry failed payments",
  scope: "global",
  prerequisiteActorPermissionIds: [],
  hasAdminPrerequisite: true,
});
