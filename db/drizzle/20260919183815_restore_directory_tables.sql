-- These tables were created by earlier migrations and have stayed in place; every
-- statement is guarded so the migration is a no-op on a database that already has them.

CREATE TABLE IF NOT EXISTS "peppol_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"color_hex" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supporting_data_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"vat_number" text,
	"enterprise_number" text,
	"peppol_addresses" text[] DEFAULT '{}',
	"address" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supporting_data_supplier_labels" (
	"supporting_data_supplier_id" text NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "supporting_data_supplier_labels_pkey" PRIMARY KEY("supporting_data_supplier_id","label_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supporting_data_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"vat_number" text,
	"peppol_addresses" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "peppol_labels" ADD CONSTRAINT "peppol_labels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supporting_data_customers" ADD CONSTRAINT "supporting_data_customers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supporting_data_supplier_labels" ADD CONSTRAINT "supporting_data_supplier_labels_supporting_data_supplier_id_supporting_data_suppliers_id_fk" FOREIGN KEY ("supporting_data_supplier_id") REFERENCES "public"."supporting_data_suppliers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supporting_data_supplier_labels" ADD CONSTRAINT "supporting_data_supplier_labels_label_id_peppol_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."peppol_labels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supporting_data_suppliers" ADD CONSTRAINT "supporting_data_suppliers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "peppol_labels_external_id_unique" ON "peppol_labels" USING btree ("team_id","external_id") WHERE "peppol_labels"."external_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supporting_customers_team_id_idx" ON "supporting_data_customers" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supporting_customers_external_id_unique" ON "supporting_data_customers" USING btree ("team_id","external_id") WHERE "supporting_data_customers"."external_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supporting_suppliers_team_id_idx" ON "supporting_data_suppliers" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supporting_suppliers_external_id_unique" ON "supporting_data_suppliers" USING btree ("team_id","external_id") WHERE "supporting_data_suppliers"."external_id" is not null;