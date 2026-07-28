ALTER TABLE "company_verification_log" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "company_verification_log" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "company_verification_log" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "company_verification_log" ADD COLUMN "country" "peppol_valid_country_codes";