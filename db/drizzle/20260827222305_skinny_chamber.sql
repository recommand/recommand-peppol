CREATE TABLE "peppol_outgoing_envelope_claims" (
	"instance_identifier" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "peppol_transmitted_documents_ap_transaction_id_idx";--> statement-breakpoint
CREATE INDEX "peppol_outgoing_envelope_claims_created_at_idx" ON "peppol_outgoing_envelope_claims" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "peppol_transmitted_documents_ap_transaction_id_idx" ON "peppol_transmitted_documents" USING btree ("ap_transaction_id") WHERE "peppol_transmitted_documents"."ap_transaction_id" is not null;