import type { ScrapedEvent } from '@disruption-intelligence/shared';

export type ScrapeResult = {
    events: ScrapedEvent[];
    /** End (exclusive) of the fully-covered scrape window, or null when any part of
     *  the window was dropped or skipped. Non-null gates the cancel-missing sweep:
     *  scheduled rows inside [now, sweepWindowEnd) that this scrape did not return
     *  were removed or rescheduled upstream. Sources without a well-defined window
     *  (e.g. futbolperuano's rolling listing) always pass null. */
    sweepWindowEnd: Date | null;
};
