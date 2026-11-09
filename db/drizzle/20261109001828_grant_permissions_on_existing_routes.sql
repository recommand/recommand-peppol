-- These permissions now guard routes that were open to every member, so every
-- member gets them, as a member who joins later does.
INSERT INTO "user_permissions" ("user_id", "team_id", "permission_id")
SELECT members."user_id", members."team_id", permissions."permission_id"
FROM "team_members" AS members
CROSS JOIN unnest(ARRAY[
  'peppol.companies.delete',
  'peppol.companies.read',
  'peppol.companies.write',
  'peppol.customers.delete',
  'peppol.customers.read',
  'peppol.customers.write',
  'peppol.document_types.delete',
  'peppol.document_types.read',
  'peppol.document_types.write',
  'peppol.documents.delete',
  'peppol.documents.export',
  'peppol.documents.generate',
  'peppol.documents.mark_as_read',
  'peppol.documents.read',
  'peppol.documents.send',
  'peppol.documents.write',
  'peppol.identifiers.delete',
  'peppol.identifiers.migrate',
  'peppol.identifiers.read',
  'peppol.identifiers.write',
  'peppol.integrations.delete',
  'peppol.integrations.read',
  'peppol.integrations.write',
  'peppol.labels.delete',
  'peppol.labels.read',
  'peppol.labels.write',
  'peppol.notification_email_addresses.delete',
  'peppol.notification_email_addresses.read',
  'peppol.notification_email_addresses.write',
  'peppol.reporting.read',
  'peppol.reporting.submit',
  'peppol.reporting.write',
  'peppol.suppliers.delete',
  'peppol.suppliers.read',
  'peppol.suppliers.write',
  'peppol.webhooks.delete',
  'peppol.webhooks.read',
  'peppol.webhooks.write'
]) AS permissions("permission_id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Existing keys get these permissions from their owner, so they keep working as before.
INSERT INTO "principal_permissions" ("principal_type", "principal_id", "team_id", "permission_id", "granted_by_user_id")
SELECT 'api_key', keys."id", keys."team_id", permissions."permission_id", keys."user_id"
FROM "api_keys" AS keys
INNER JOIN "user_permissions" AS permissions
ON permissions."user_id" = keys."user_id" AND permissions."team_id" = keys."team_id"
WHERE permissions."permission_id" LIKE 'peppol.%'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Admins hold every team permission without rows, so their keys get them explicitly.
INSERT INTO "principal_permissions" ("principal_type", "principal_id", "team_id", "permission_id", "granted_by_user_id")
SELECT 'api_key', keys."id", keys."team_id", permissions."permission_id", keys."user_id"
FROM "api_keys" AS keys
INNER JOIN "users" ON "users"."id" = keys."user_id"
CROSS JOIN unnest(ARRAY[
  'peppol.companies.delete',
  'peppol.companies.read',
  'peppol.companies.write',
  'peppol.customers.delete',
  'peppol.customers.read',
  'peppol.customers.write',
  'peppol.document_types.delete',
  'peppol.document_types.read',
  'peppol.document_types.write',
  'peppol.documents.delete',
  'peppol.documents.export',
  'peppol.documents.generate',
  'peppol.documents.mark_as_read',
  'peppol.documents.read',
  'peppol.documents.send',
  'peppol.documents.write',
  'peppol.identifiers.delete',
  'peppol.identifiers.migrate',
  'peppol.identifiers.read',
  'peppol.identifiers.write',
  'peppol.integrations.delete',
  'peppol.integrations.read',
  'peppol.integrations.write',
  'peppol.labels.delete',
  'peppol.labels.read',
  'peppol.labels.write',
  'peppol.notification_email_addresses.delete',
  'peppol.notification_email_addresses.read',
  'peppol.notification_email_addresses.write',
  'peppol.reporting.read',
  'peppol.reporting.submit',
  'peppol.reporting.write',
  'peppol.suppliers.delete',
  'peppol.suppliers.read',
  'peppol.suppliers.write',
  'peppol.webhooks.delete',
  'peppol.webhooks.read',
  'peppol.webhooks.write'
]) AS permissions("permission_id")
WHERE "users"."is_admin" = true
ON CONFLICT DO NOTHING;
