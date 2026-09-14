CREATE TYPE "public"."peppol_delivery_channel" AS ENUM('peppol', 'email');--> statement-breakpoint
CREATE TYPE "public"."peppol_delivery_failure_category" AS ENUM('recipient_not_found', 'document_not_supported', 'validation', 'transport', 'recipient_rejected', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."peppol_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "peppol_document_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"transmitted_document_id" text NOT NULL,
	"team_id" text NOT NULL,
	"company_id" text NOT NULL,
	"channel" "peppol_delivery_channel" NOT NULL,
	"address" text NOT NULL,
	"status" "peppol_delivery_status" NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_category" "peppol_delivery_failure_category",
	"failure_message" text,
	"failure_provider_code" text,
	"provider" text,
	"use_test_network" boolean DEFAULT false NOT NULL,
	"provider_transaction_id" text,
	"provider_event_id" text,
	"provider_event_type" text,
	"provider_payload" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peppol_provider_delivery_reports" (
	"provider_transaction_id" text PRIMARY KEY NOT NULL,
	"channel" "peppol_delivery_channel" NOT NULL,
	"provider" text NOT NULL,
	"use_test_network" boolean DEFAULT false NOT NULL,
	"status" "peppol_delivery_status" NOT NULL,
	"failure_category" "peppol_delivery_failure_category",
	"failure_message" text,
	"failure_provider_code" text,
	"event_id" text,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "email_fallback" jsonb;--> statement-breakpoint
ALTER TABLE "peppol_document_deliveries" ADD CONSTRAINT "peppol_document_deliveries_transmitted_document_id_peppol_transmitted_documents_id_fk" FOREIGN KEY ("transmitted_document_id") REFERENCES "public"."peppol_transmitted_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peppol_document_deliveries_document_idx" ON "peppol_document_deliveries" USING btree ("transmitted_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_document_deliveries_provider_transaction_idx" ON "peppol_document_deliveries" USING btree ("provider_transaction_id") WHERE "peppol_document_deliveries"."provider_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "peppol_document_deliveries_pending_idx" ON "peppol_document_deliveries" USING btree ("status","channel","status_changed_at");--> statement-breakpoint
CREATE INDEX "peppol_transmitted_documents_email_fallback_idx" ON "peppol_transmitted_documents" USING btree ("id") WHERE "peppol_transmitted_documents"."email_fallback" is not null;