CREATE TABLE "ingest_state" (
	"source_id" text PRIMARY KEY NOT NULL,
	"cursor" jsonb,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
