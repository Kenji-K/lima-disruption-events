CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."event_state" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"centroid" geography(Point, 4326) NOT NULL,
	"timezone" text NOT NULL,
	CONSTRAINT "cities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"city_id" integer NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"state" "event_state" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"location" geography(Point, 4326),
	"source_payload" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_uq" ON "events" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "events_city_state_start_idx" ON "events" USING btree ("city_id","state","start_at") WHERE "events"."state" = 'scheduled';--> statement-breakpoint
CREATE INDEX "events_city_category_idx" ON "events" USING btree ("city_id","category") WHERE "events"."state" = 'scheduled';--> statement-breakpoint
CREATE INDEX "events_start_at_brin_idx" ON "events" USING brin ("start_at"); -- ADR-001
--> statement-breakpoint
CREATE INDEX "events_location_gix" ON "events" USING gist ("location"); -- ADR-002
--> statement-breakpoint
INSERT INTO "cities" ("slug", "name", "centroid", "timezone")
VALUES ('lima', 'Lima', ST_GeogFromText('SRID=4326;POINT(-77.0428 -12.0464)'), 'America/Lima')
ON CONFLICT ("slug") DO NOTHING;