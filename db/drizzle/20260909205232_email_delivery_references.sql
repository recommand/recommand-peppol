DROP INDEX "peppol_document_deliveries_provider_transaction_idx";--> statement-breakpoint
ALTER TABLE "peppol_provider_delivery_reports" DROP CONSTRAINT "peppol_provider_delivery_reports_pkey";--> statement-breakpoint
ALTER TABLE "peppol_provider_delivery_reports" ADD CONSTRAINT "peppol_provider_delivery_reports_pkey" PRIMARY KEY("provider","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_document_deliveries_provider_reference_idx" ON "peppol_document_deliveries" USING btree ("provider","provider_transaction_id") WHERE "peppol_document_deliveries"."provider_transaction_id" is not null;
