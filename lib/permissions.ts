import { registerPermission } from "@core/lib/permissions";
import { PEPPOL_PERMISSIONS } from "@peppol/lib/permission-ids";

registerPermission({
  id: PEPPOL_PERMISSIONS.IMPORTS_READ,
  name: "Read imports",
  description: "See uploaded and emailed files and how they were processed",
  scope: "team",
  prerequisiteActorPermissionIds: ["core.team.manage"],
  isAddedOnTeamCreation: true,
});

registerPermission({
  id: PEPPOL_PERMISSIONS.IMPORTS_WRITE,
  name: "Upload documents",
  description: "Upload PDF and XML files to be processed into documents and delete finished imports",
  scope: "team",
  prerequisiteActorPermissionIds: ["core.team.manage"],
  isAddedOnTeamCreation: true,
});

registerPermission({
  id: PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_READ,
  name: "Read inbound email addresses",
  description: "See the email addresses that receive documents for the team's companies",
  scope: "team",
  prerequisiteActorPermissionIds: ["core.team.manage"],
  isAddedOnTeamCreation: true,
});

registerPermission({
  id: PEPPOL_PERMISSIONS.INBOUND_ADDRESSES_MANAGE,
  name: "Manage inbound email addresses",
  description: "Create, enable, disable and delete the email addresses that receive documents for the team's companies",
  scope: "team",
  prerequisiteActorPermissionIds: ["core.team.manage"],
  isAddedOnTeamCreation: true,
});
