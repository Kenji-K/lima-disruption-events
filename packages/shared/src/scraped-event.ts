import { z } from 'zod';
import { locationSchema } from './location';

export const scrapedEventSchema = z
    .object({
        sourceId: z.string().min(1),
        externalId: z.string().min(1),
        title: z.string().min(1),
        startAt: z.iso.datetime({ offset: true }),
        endAt: z.iso.datetime({ offset: true }).optional(),
        location: locationSchema.optional(),
        state: z.enum(['scheduled', 'cancelled']),
        category: z.string().min(1),
        sourcePayload: z.unknown(),
        // http(s) only: a bare z.url() accepts javascript: URLs, and sourceUrl ends
        // up in customer-facing <a href> — a scraper copying a raw upstream href
        // must not be able to plant a stored-XSS payload.
        sourceUrl: z.url({ protocol: /^https?$/ }).optional(),
        // ADR-009: cross-channel dedup key (newsDedupKey of the headline).
        // News-derived sources only; omit — never empty-string — when absent.
        dedupKey: z.string().min(1).optional(),
    })
    .refine((data) => !data.endAt || new Date(data.endAt) > new Date(data.startAt), {
        error: 'endAt must be after startAt',
        path: ['endAt'],
    });

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>;
