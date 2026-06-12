CREATE TABLE "ingest_quarantine" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"reason" text NOT NULL,
	"detail" jsonb,
	"post_date" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_quarantine_source_external_uq" ON "ingest_quarantine" USING btree ("source_id","external_id");