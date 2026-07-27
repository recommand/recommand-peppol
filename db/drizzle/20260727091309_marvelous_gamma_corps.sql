ALTER TYPE "public"."peppol_supported_document_type" ADD VALUE 'frenchB2cSalesReport' BEFORE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."peppol_supported_document_type" ADD VALUE 'frenchB2cPaymentReport' BEFORE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."peppol_transfer_event_type" ADD VALUE 'reporting';--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "external_reference_id" text;