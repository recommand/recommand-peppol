CREATE TYPE "public"."peppol_fr_reporting_declarant_state" AS ENUM('pending', 'registered', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."peppol_fr_reporting_environment" AS ENUM('PROD', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."peppol_fr_vat_exigibility" AS ENUM('ENCAISSEMENTS', 'DEBITS');--> statement-breakpoint
CREATE TYPE "public"."peppol_fr_vat_regime" AS ENUM('REEL_NORMAL_MENSUEL', 'REEL_SIMPLIFIE', 'FRANCHISE_EN_BASE');--> statement-breakpoint
CREATE TABLE "peppol_fr_reporting_declarants" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"environment" "peppol_fr_reporting_environment" NOT NULL,
	"siren" text NOT NULL,
	"issuer_name" text NOT NULL,
	"vat_regime" "peppol_fr_vat_regime" NOT NULL,
	"vat_exigibility" "peppol_fr_vat_exigibility" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"state" "peppol_fr_reporting_declarant_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"registered_at" timestamp with time zone,
	"partner_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_fr_reporting_declarants" ADD CONSTRAINT "peppol_fr_reporting_declarants_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_fr_reporting_declarants_company_environment_idx" ON "peppol_fr_reporting_declarants" USING btree ("company_id","environment");--> statement-breakpoint
CREATE INDEX "peppol_fr_reporting_declarants_due_idx" ON "peppol_fr_reporting_declarants" USING btree ("state","next_attempt_at");