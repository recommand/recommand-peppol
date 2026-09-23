CREATE TYPE "public"."peppol_fr_reporting_status" AS ENUM('accepted', 'pending_rectificative', 'filed', 'filed_rectificative', 'superseded', 'rejected');--> statement-breakpoint
CREATE TABLE "peppol_fr_reporting_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"transmitted_document_id" text NOT NULL,
	"declarant_id" text,
	"team_id" text NOT NULL,
	"company_id" text NOT NULL,
	"environment" "peppol_fr_reporting_environment" NOT NULL,
	"flow_id" text NOT NULL,
	"reference" text NOT NULL,
	"sub_flux" text NOT NULL,
	"operation" text NOT NULL,
	"transmission_type" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"ledger_status" text,
	"reporting_status" "peppol_fr_reporting_status" DEFAULT 'accepted' NOT NULL,
	"received_at" timestamp with time zone,
	"operation_date" text,
	"period_start" text,
	"period_end" text,
	"submission_id" text,
	"outcome_code" text,
	"outcome_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_fr_reporting_submissions" ADD CONSTRAINT "peppol_fr_reporting_submissions_transmitted_document_id_peppol_transmitted_documents_id_fk" FOREIGN KEY ("transmitted_document_id") REFERENCES "public"."peppol_transmitted_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_fr_reporting_submissions" ADD CONSTRAINT "peppol_fr_reporting_submissions_declarant_id_peppol_fr_reporting_declarants_id_fk" FOREIGN KEY ("declarant_id") REFERENCES "public"."peppol_fr_reporting_declarants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_fr_reporting_submissions_flow_id_idx" ON "peppol_fr_reporting_submissions" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_fr_reporting_submissions_document_idx" ON "peppol_fr_reporting_submissions" USING btree ("transmitted_document_id");--> statement-breakpoint
CREATE INDEX "peppol_fr_reporting_submissions_due_idx" ON "peppol_fr_reporting_submissions" USING btree ("next_check_at");