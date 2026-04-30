import { z } from 'zod';

export const locationSchema = z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
});

export type Location = z.infer<typeof locationSchema>;
