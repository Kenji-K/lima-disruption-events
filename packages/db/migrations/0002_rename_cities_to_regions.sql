-- ADR-005: rename cities → regions, add hierarchy columns, backfill Lima.
-- Hand-authored, not drizzle-kit-generated — Kit's diff has no rename heuristic
-- and would emit DROP TABLE cities + CREATE TABLE regions, destroying the existing
-- 83 GTN events' FK target. See docs/ARCHITECTURE.md "Drizzle Kit gotcha" for the
-- broader hand-edit precedent.

-- Drop legacy single-column UNIQUE on slug. It survives the rename as
-- 'cities_slug_unique' on the renamed table, but would conflict with the new
-- composite UNIQUE the moment a second country lands with slug='lima'.
ALTER TABLE "cities" DROP CONSTRAINT "cities_slug_unique";--> statement-breakpoint

ALTER TABLE "cities" RENAME TO "regions";--> statement-breakpoint

-- Backfill Lima's two new NOT NULL columns via DEFAULT-then-DROP. One row,
-- no table rewrite cost. Subsequent inserts must specify country_code/level
-- explicitly — the default is migration-only.
ALTER TABLE "regions" ADD COLUMN "country_code" char(2) NOT NULL DEFAULT 'PE';--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "country_code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "level" smallint NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "regions" ALTER COLUMN "level" DROP DEFAULT;--> statement-breakpoint

-- Nullable additions + self-referencing FK for the hierarchy.
ALTER TABLE "regions" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_id_regions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "iso_code" text;--> statement-breakpoint

-- Lima's iso_code is the only single-row data backfill that needs an explicit UPDATE.
UPDATE "regions" SET "iso_code" = 'PE-LIM' WHERE "slug" = 'lima';--> statement-breakpoint

-- Constraints land after backfill so they don't fire on partially-populated rows.
ALTER TABLE "regions" ADD CONSTRAINT "regions_country_level_slug_uq" UNIQUE("country_code","level","slug");--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_level_parent_check" CHECK (("regions"."level" = 1 AND "regions"."parent_id" IS NULL) OR ("regions"."level" > 1 AND "regions"."parent_id" IS NOT NULL));--> statement-breakpoint

-- FK column + matching index renames on events.
ALTER TABLE "events" RENAME COLUMN "city_id" TO "region_id";--> statement-breakpoint
ALTER TABLE "events" RENAME CONSTRAINT "events_city_id_cities_id_fk" TO "events_region_id_regions_id_fk";--> statement-breakpoint
ALTER INDEX "events_city_state_start_idx" RENAME TO "events_region_state_start_idx";--> statement-breakpoint
ALTER INDEX "events_city_category_idx" RENAME TO "events_region_category_idx";
