-- These permissions now guard routes that were open to every member, so every
-- member gets them, as a member who joins later does.
INSERT INTO "user_permissions" ("user_id", "team_id", "permission_id")
SELECT members."user_id", members."team_id", permissions."permission_id"
FROM "team_members" AS members
CROSS JOIN unnest(ARRAY[
  'exchange.companies.delete',
  'exchange.companies.read',
  'exchange.companies.write',
  'exchange.customers.delete',
  'exchange.customers.read',
  'exchange.customers.write',
  'exchange.document_types.delete',
  'exchange.document_types.read',
  'exchange.document_types.write',
  'exchange.documents.delete',
  'exchange.documents.export',
  'exchange.documents.generate',
  'exchange.documents.mark_as_read',
  'exchange.documents.read',
  'exchange.documents.send',
  'exchange.documents.write',
  'exchange.identifiers.delete',
  'exchange.identifiers.migrate',
  'exchange.identifiers.read',
  'exchange.identifiers.write',
  'exchange.integrations.delete',
  'exchange.integrations.read',
  'exchange.integrations.write',
  'exchange.labels.delete',
  'exchange.labels.read',
  'exchange.labels.write',
  'exchange.notification_email_addresses.delete',
  'exchange.notification_email_addresses.read',
  'exchange.notification_email_addresses.write',
  'exchange.reporting.read',
  'exchange.reporting.submit',
  'exchange.reporting.write',
  'exchange.suppliers.delete',
  'exchange.suppliers.read',
  'exchange.suppliers.write',
  'exchange.webhooks.delete',
  'exchange.webhooks.read',
  'exchange.webhooks.write'
]) AS permissions("permission_id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Existing keys get these permissions from their owner, so they keep working as before.
INSERT INTO "principal_permissions" ("principal_type", "principal_id", "team_id", "permission_id", "granted_by_user_id")
SELECT 'api_key', keys."id", keys."team_id", permissions."permission_id", keys."user_id"
FROM "api_keys" AS keys
INNER JOIN "user_permissions" AS permissions
ON permissions."user_id" = keys."user_id" AND permissions."team_id" = keys."team_id"
WHERE permissions."permission_id" LIKE 'exchange.%'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Admins hold every team permission without rows, so their keys get them explicitly.
INSERT INTO "principal_permissions" ("principal_type", "principal_id", "team_id", "permission_id", "granted_by_user_id")
SELECT 'api_key', keys."id", keys."team_id", permissions."permission_id", keys."user_id"
FROM "api_keys" AS keys
INNER JOIN "users" ON "users"."id" = keys."user_id"
CROSS JOIN unnest(ARRAY[
  'exchange.companies.delete',
  'exchange.companies.read',
  'exchange.companies.write',
  'exchange.customers.delete',
  'exchange.customers.read',
  'exchange.customers.write',
  'exchange.document_types.delete',
  'exchange.document_types.read',
  'exchange.document_types.write',
  'exchange.documents.delete',
  'exchange.documents.export',
  'exchange.documents.generate',
  'exchange.documents.mark_as_read',
  'exchange.documents.read',
  'exchange.documents.send',
  'exchange.documents.write',
  'exchange.identifiers.delete',
  'exchange.identifiers.migrate',
  'exchange.identifiers.read',
  'exchange.identifiers.write',
  'exchange.integrations.delete',
  'exchange.integrations.read',
  'exchange.integrations.write',
  'exchange.labels.delete',
  'exchange.labels.read',
  'exchange.labels.write',
  'exchange.notification_email_addresses.delete',
  'exchange.notification_email_addresses.read',
  'exchange.notification_email_addresses.write',
  'exchange.reporting.read',
  'exchange.reporting.submit',
  'exchange.reporting.write',
  'exchange.suppliers.delete',
  'exchange.suppliers.read',
  'exchange.suppliers.write',
  'exchange.webhooks.delete',
  'exchange.webhooks.read',
  'exchange.webhooks.write'
]) AS permissions("permission_id")
WHERE "users"."is_admin" = true
ON CONFLICT DO NOTHING;
