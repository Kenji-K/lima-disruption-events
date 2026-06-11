ALTER TABLE "events" ADD COLUMN "dedup_key" text;--> statement-breakpoint
CREATE INDEX "events_dedup_key_idx" ON "events" USING btree ("dedup_key") WHERE "events"."dedup_key" IS NOT NULL;--> statement-breakpoint
-- ADR-009 backfill: key the few pre-existing news rows so the gob.pe channels
-- can't duplicate them. translate() folds the Spanish character set the same
-- way the TS slugifier's NFD strip does (equivalence spot-checked post-deploy).
UPDATE "events"
SET "dedup_key" = NULLIF(
    trim(BOTH '-' FROM regexp_replace(
        lower(translate("title", 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')),
        '[^a-z0-9]+', '-', 'g'
    )), '')
WHERE "source_id" IN ('mml', 'lima-expresa');
