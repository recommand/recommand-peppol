CREATE TYPE "public"."peppol_payload_location" AS ENUM('none', 'db', 's3');--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "xml_location" "peppol_payload_location" DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "attachments_location" "peppol_payload_location" DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "s3_key_prefix" text;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "offload_claimed_at" timestamp with time zone;