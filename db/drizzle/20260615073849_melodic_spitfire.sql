CREATE TABLE "pending_s3_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
