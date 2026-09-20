CREATE TYPE "public"."peppol_participant_migration_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."peppol_participant_migration_status" AS ENUM('pending', 'inProgress', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "peppol_participant_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"scheme" text NOT NULL,
	"identifier" text NOT NULL,
	"direction" "peppol_participant_migration_direction" NOT NULL,
	"status" "peppol_participant_migration_status" NOT NULL,
	"migration_key" text NOT NULL,
	"use_test_network" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_participant_migrations" ADD CONSTRAINT "peppol_participant_migrations_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peppol_participant_migrations_company_idx" ON "peppol_participant_migrations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_participant_migrations_open_unique" ON "peppol_participant_migrations" USING btree ("company_id","scheme","identifier","use_test_network") WHERE "peppol_participant_migrations"."status" in ('pending', 'inProgress');