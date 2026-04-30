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
        sourceUrl: z.url().optional(),
    })
    .refine((data) => !data.endAt || new Date(data.endAt) > new Date(data.startAt), {
        error: 'endAt must be after startAt',
        path: ['endAt'],
    });

export type ScrapedEvent = z.infer<typeof scrapedEventSchema>;
