CREATE TABLE "peppol_prepared_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fixed_route" boolean DEFAULT false NOT NULL,
	"input" jsonb NOT NULL,
	"company_id" text NOT NULL,
	"team_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_prepared_sends" ADD CONSTRAINT "peppol_prepared_sends_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_prepared_sends" ADD CONSTRAINT "peppol_prepared_sends_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peppol_prepared_sends_expires_at_idx" ON "peppol_prepared_sends" USING btree ("expires_at");