ALTER TABLE "events" ADD COLUMN "venue_name" text;--> statement-breakpoint
-- Backfill venue_name for pre-existing rows from each source's stable
-- sourcePayload shape (same precedent as 0004's dedup_key backfill).
UPDATE "events" SET "venue_name" = 'Gran Teatro Nacional' WHERE "source_id" = 'gran-teatro-nacional';--> statement-breakpoint
UPDATE "events" SET "venue_name" = "source_payload"->>'venue' WHERE "source_id" IN ('joinnus', 'costa-21') AND "source_payload"->>'venue' IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "venue_name" = "source_payload"->>'stadium' WHERE "source_id" = 'futbolperuano' AND "source_payload"->>'stadium' IS NOT NULL;
