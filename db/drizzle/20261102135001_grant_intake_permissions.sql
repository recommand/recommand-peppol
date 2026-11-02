-- Grant the document intake permissions to every existing team member. Every member
-- could use every part of the Peppol package before these permissions existed, and
-- new teams get them on creation. API keys keep the permissions they have: a key gets
-- these only when someone grants them to it.
INSERT INTO "user_permissions" ("user_id", "team_id", "permission_id", "granted_by_user_id")
SELECT "team_members"."user_id", "team_members"."team_id", "permissions"."permission_id", NULL
FROM "team_members"
CROSS JOIN (VALUES
  ('peppol.imports.read'),
  ('peppol.imports.write'),
  ('peppol.inbound_addresses.read'),
  ('peppol.inbound_addresses.manage')
) AS "permissions" ("permission_id")
WHERE "team_members"."user_id" IS NOT NULL AND "team_members"."team_id" IS NOT NULL
ON CONFLICT ("user_id", "team_id", "permission_id") DO NOTHING;
