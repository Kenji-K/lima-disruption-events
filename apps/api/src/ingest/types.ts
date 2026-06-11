import type { Logger } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';

export type ScrapeResult = {
    events: ScrapedEvent[];
    /** End (exclusive) of the fully-covered scrape window, or null when any part of
     *  the window was dropped or skipped. Non-null gates the cancel-missing sweep:
     *  scheduled rows inside [now, sweepWindowEnd) that this scrape did not return
     *  were removed or rescheduled upstream. Sources without a well-defined window
     *  (e.g. futbolperuano's rolling listing) always pass null. Incremental sources
     *  (news polls) always pass null — a delta poll never covers a window (ADR-007). */
    sweepWindowEnd: Date | null;
    /** New resume state for incremental sources (ADR-007). Persisted by the runner
     *  only after this result's events were validated and upserted successfully.
     *  Omit (undefined) to leave the stored cursor untouched — full-window scrapers
     *  always omit it. */
    nextCursor?: unknown;
};

/** A registered source: `name` is the events.source_id it stamps AND the
 *  ingest_state key. `cursor` is the stored resume state from the previous
 *  successful run (null on first run); full-window scrapers ignore it. */
export type Scraper = {
    name: string;
    scrape: (log: Logger, cursor: unknown) => Promise<ScrapeResult>;
};
