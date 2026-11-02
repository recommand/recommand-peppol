CREATE TYPE "public"."peppol_document_source_channel" AS ENUM('peppol', 'email', 'api');--> statement-breakpoint
CREATE TYPE "public"."peppol_import_channel" AS ENUM('api', 'email');--> statement-breakpoint
CREATE TYPE "public"."peppol_import_result_status" AS ENUM('pending', 'document', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."peppol_import_status" AS ENUM('queued', 'processing', 'completed', 'partially_completed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."peppol_inbound_address_status" AS ENUM('provisioning', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."peppol_processing_method" AS ENUM('parsed', 'extracted');--> statement-breakpoint
ALTER TYPE "public"."peppol_transfer_event_type" ADD VALUE 'api';--> statement-breakpoint
CREATE TABLE "peppol_files" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"company_id" text NOT NULL,
	"import_id" text,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"format" text,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"s3_key" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peppol_import_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"result_id" text NOT NULL,
	"stage" text NOT NULL,
	"model" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "peppol_import_results" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"position" integer NOT NULL,
	"sequence" integer,
	"locations" jsonb NOT NULL,
	"status" "peppol_import_result_status" DEFAULT 'pending' NOT NULL,
	"checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" text,
	"error" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peppol_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"company_id" text NOT NULL,
	"channel" "peppol_import_channel" NOT NULL,
	"inbound_address_id" text,
	"status" "peppol_import_status" DEFAULT 'queued' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"expected_type" text,
	"accepted_types" text[],
	"direction" "peppol_transfer_event_direction" DEFAULT 'incoming' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"label_ids" text[] DEFAULT '{}' NOT NULL,
	"source" jsonb NOT NULL,
	"idempotency_key" text,
	"request_hash" text,
	"idempotency_response" jsonb,
	"provider_message_id" text,
	"raw_sha256" text,
	"plan_checkpoint" jsonb,
	"result_sequence" integer DEFAULT 0 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "peppol_inbound_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"company_id" text NOT NULL,
	"local_part" text NOT NULL,
	"address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "peppol_inbound_address_status" DEFAULT 'active' NOT NULL,
	"accepted_types" text[],
	"error" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"request_hash" text,
	"idempotency_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "peppol_transfer_events" ADD COLUMN "ai_processed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "source_channel" "peppol_document_source_channel";--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "import_id" text;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "processing_method" "peppol_processing_method";--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "findings" jsonb;--> statement-breakpoint
ALTER TABLE "peppol_files" ADD CONSTRAINT "peppol_files_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_files" ADD CONSTRAINT "peppol_files_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_files" ADD CONSTRAINT "peppol_files_import_id_peppol_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."peppol_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_import_attempts" ADD CONSTRAINT "peppol_import_attempts_import_id_peppol_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."peppol_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_import_attempts" ADD CONSTRAINT "peppol_import_attempts_result_id_peppol_import_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."peppol_import_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_import_results" ADD CONSTRAINT "peppol_import_results_import_id_peppol_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."peppol_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_import_results" ADD CONSTRAINT "peppol_import_results_document_id_peppol_transmitted_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."peppol_transmitted_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_imports" ADD CONSTRAINT "peppol_imports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_imports" ADD CONSTRAINT "peppol_imports_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_imports" ADD CONSTRAINT "peppol_imports_inbound_address_id_peppol_inbound_addresses_id_fk" FOREIGN KEY ("inbound_address_id") REFERENCES "public"."peppol_inbound_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_inbound_addresses" ADD CONSTRAINT "peppol_inbound_addresses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peppol_inbound_addresses" ADD CONSTRAINT "peppol_inbound_addresses_company_id_peppol_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."peppol_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peppol_files_import_idx" ON "peppol_files" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "peppol_import_attempts_import_idx" ON "peppol_import_attempts" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "peppol_import_results_import_idx" ON "peppol_import_results" USING btree ("import_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_import_results_sequence_idx" ON "peppol_import_results" USING btree ("import_id","sequence") WHERE "peppol_import_results"."sequence" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_imports_idempotency_idx" ON "peppol_imports" USING btree ("company_id","idempotency_key") WHERE "peppol_imports"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_imports_provider_message_idx" ON "peppol_imports" USING btree ("inbound_address_id","provider_message_id") WHERE "peppol_imports"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "peppol_imports_company_idx" ON "peppol_imports" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "peppol_imports_waiting_idx" ON "peppol_imports" USING btree ("next_attempt_at") WHERE "peppol_imports"."status" in ('queued', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_inbound_addresses_local_part_idx" ON "peppol_inbound_addresses" USING btree ("local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_inbound_addresses_idempotency_idx" ON "peppol_inbound_addresses" USING btree ("company_id","idempotency_key") WHERE "peppol_inbound_addresses"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "peppol_inbound_addresses_company_idx" ON "peppol_inbound_addresses" USING btree ("company_id","id");