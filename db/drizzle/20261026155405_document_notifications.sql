CREATE TABLE "peppol_document_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"transmitted_document_id" text NOT NULL,
	"company_id" text NOT NULL,
	"direction" "peppol_transfer_event_direction" NOT NULL,
	"address" text NOT NULL,
	"status" "peppol_delivery_status" NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_category" "peppol_delivery_failure_category",
	"failure_message" text,
	"failure_provider_code" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peppol_company_notification_email_addresses" ADD COLUMN "unreachable_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "peppol_company_notification_email_addresses" ADD COLUMN "unreachable_reason" text;--> statement-breakpoint
ALTER TABLE "peppol_document_notifications" ADD CONSTRAINT "peppol_document_notifications_transmitted_document_id_peppol_transmitted_documents_id_fk" FOREIGN KEY ("transmitted_document_id") REFERENCES "public"."peppol_transmitted_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peppol_document_notifications_document_idx" ON "peppol_document_notifications" USING btree ("transmitted_document_id");--> statement-breakpoint
CREATE INDEX "peppol_document_notifications_address_idx" ON "peppol_document_notifications" USING btree ("address","created_at");