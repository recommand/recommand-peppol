INSERT INTO "rules" ("id", "team_id", "name", "enabled", "event_type", "condition", "actions", "schema_version", "created_at", "updated_at")
SELECT
	"id",
	"team_id",
	'Webhook: ' || "url",
	true,
	'*',
	CASE
		WHEN "company_id" IS NULL THEN NULL
		ELSE jsonb_build_object(
			'version', 1,
			'match', jsonb_build_object(
				'payload.companyId', jsonb_build_object('eq', "company_id")
			)
		)
	END,
	jsonb_build_array(
		jsonb_build_object(
			'type', 'webhook',
			'version', 1,
			'config', jsonb_build_object('url', "url")
		)
	),
	1,
	"created_at",
	"updated_at"
FROM "peppol_webhooks"
ON CONFLICT ("id") DO NOTHING;
