import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { geographyPoint } from './_types';

export const cities = pgTable('cities', {
    id: serial().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    centroid: geographyPoint().notNull(),
    timezone: text().notNull(),
});