CREATE TYPE "public"."peppol_access_point_provider" AS ENUM('recommand-ap1');--> statement-breakpoint
CREATE TYPE "public"."peppol_smp_provider" AS ENUM('recommand-smp1');--> statement-breakpoint
ALTER TABLE "peppol_companies" ADD COLUMN "access_point_provider" "peppol_access_point_provider" DEFAULT 'recommand-ap1' NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_companies" ADD COLUMN "smp_provider" "peppol_smp_provider" DEFAULT 'recommand-smp1' NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "access_point_provider" "peppol_access_point_provider" DEFAULT 'recommand-ap1' NOT NULL;--> statement-breakpoint
ALTER TABLE "peppol_transmitted_documents" ADD COLUMN "smp_provider" "peppol_smp_provider" DEFAULT 'recommand-smp1' NOT NULL;