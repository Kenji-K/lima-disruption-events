import { customType } from 'drizzle-orm/pg-core';

export type GeographyPoint = { lng: number; lat: number };

export const geographyPoint = customType<{
    data: GeographyPoint,
    driverData: string,
}>({
    dataType() { return 'geography(Point, 4326)'; },
    toDriver(value) { return `SRID=4326;POINT(${value.lng} ${value.lat})` },
    fromDriver(value) { return value as unknown as GeographyPoint; /* TODO: parse EWKB or switch reads to ST_AsText */ }
});
