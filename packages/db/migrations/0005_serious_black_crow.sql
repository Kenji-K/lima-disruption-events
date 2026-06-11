CREATE TABLE "road_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"estado" text NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"codigo_via" text,
	"nombre_carretera" text,
	"afectacion" text,
	"evento" text,
	"motivo" text,
	"fuente" text,
	"ubigeo" text,
	"reported_at" timestamp with time zone,
	"event_started_on" date,
	"dataset_updated_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_payload" jsonb NOT NULL,
	CONSTRAINT "road_alerts_estado_chk" CHECK ("road_alerts"."estado" IN ('normal', 'restringido', 'interrumpido'))
);
--> statement-breakpoint
CREATE INDEX "road_alerts_location_gix" ON "road_alerts" USING gist ("location");