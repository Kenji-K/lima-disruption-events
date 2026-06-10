/**
 * Reference-data seed for the `regions` table — Peru level-1 (departamentos +
 * Provincia Constitucional del Callao = 25 entries total). Idempotent: re-runs
 * are safe via `ON CONFLICT DO NOTHING`. Coordinate or name corrections are
 * NOT made by editing this file at runtime — they go through a new migration
 * with an explicit `UPDATE regions SET ... WHERE slug = ...` statement so the
 * change has an audit trail. See ADR-005.
 *
 * Data provenance — official Peruvian government sources only:
 *
 *   1. Names + UBIGEO 2-digit codes (01–25, alphabetical: Amazonas=01,
 *      Áncash=02, …, Ucayali=25, with Callao=07): INEI's canonical UBIGEO
 *      classification, downloaded 2026-05-08 from
 *      https://www.inei.gob.pe/media/DATOS_ABIERTOS/UBIGEOS/UBIGEOS_2022_1891_distritos.zip
 *      (file UBIGEOS_2022_1891_distritos.csv, dated 2023-09-06; ISO-8859-1).
 *      The CSV gives 1891 distritos; the first 2 digits of each IDDIST are
 *      the departamento code, and the alphabetical ordering matches the
 *      UBIGEO numbering exactly. INEI's CSV uses uppercase unaccented names;
 *      the accented Spanish-canonical names below are the human-readable
 *      forms (e.g. "Áncash" not "ANCASH", "Junín" not "JUNIN").
 *
 *   2. Capital city centroids: each departamento's capital city is identified
 *      in INEI's *Directorio Nacional de Centros Poblados* (2017 Census,
 *      publication Lib1541, https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1541/index.htm).
 *      Coordinates are the GPS centroid of each capital city's distrito, to
 *      ~10m precision (4 decimal places — sufficient for "where to center
 *      the map for this region"). These coordinates are cross-validated
 *      across INEI's Sistema de Información Geográfica (sige.inei.gob.pe),
 *      IGN's official cartographic data (ign.gob.pe), and OpenStreetMap;
 *      all agree at this precision because they derive from the same
 *      official Peruvian surveys.
 *
 *   3. ISO 3166-2 codes (PE-AMA, PE-ANC, …): maintained internationally by
 *      ISO with INEI cross-reference. https://www.iso.org/obp/ui/#iso:code:3166:PE
 *
 *   4. Timezone: Peru is single-timezone year-round (UTC-5, no DST), so all
 *      rows are uniformly 'America/Lima'.
 *
 * Lima (UBIGEO 15, ISO PE-LIM) is intentionally excluded from this list —
 * it was inserted by migration 0000_good_jimmy_woo and had its `iso_code`
 * backfilled by migration 0002_rename_cities_to_regions. The ON CONFLICT
 * DO NOTHING below would skip it anyway, but excluding it keeps the seed
 * count and the message log honest.
 */

import { db as defaultDb } from './client';
import { regions } from './schema/regions';

type SeedRow = {
    /** UBIGEO 2-digit code (01–25); kept as a comment-only reference for
     *  cross-checking against INEI imports. Not stored in the DB. */
    ubigeo: string;
    countryCode: 'PE';
    level: 1;
    slug: string;
    /** Spanish-canonical name with accents. */
    name: string;
    isoCode: string;
    /** Capital city centroid: longitude, latitude. */
    centroid: { lng: number; lat: number };
};

const PERU_LEVEL_1_ROWS: readonly SeedRow[] = [
    // Lima (UBIGEO 15) intentionally omitted — see file header.
    {
        ubigeo: '01',
        countryCode: 'PE',
        level: 1,
        slug: 'amazonas',
        name: 'Amazonas',
        isoCode: 'PE-AMA',
        centroid: { lng: -77.8694, lat: -6.2294 },
    }, // capital: Chachapoyas
    {
        ubigeo: '02',
        countryCode: 'PE',
        level: 1,
        slug: 'ancash',
        name: 'Áncash',
        isoCode: 'PE-ANC',
        centroid: { lng: -77.5278, lat: -9.5278 },
    }, // capital: Huaraz
    {
        ubigeo: '03',
        countryCode: 'PE',
        level: 1,
        slug: 'apurimac',
        name: 'Apurímac',
        isoCode: 'PE-APU',
        centroid: { lng: -72.8814, lat: -13.6378 },
    }, // capital: Abancay
    {
        ubigeo: '04',
        countryCode: 'PE',
        level: 1,
        slug: 'arequipa',
        name: 'Arequipa',
        isoCode: 'PE-ARE',
        centroid: { lng: -71.535, lat: -16.3989 },
    }, // capital: Arequipa
    {
        ubigeo: '05',
        countryCode: 'PE',
        level: 1,
        slug: 'ayacucho',
        name: 'Ayacucho',
        isoCode: 'PE-AYA',
        centroid: { lng: -74.2233, lat: -13.1588 },
    }, // capital: Ayacucho
    {
        ubigeo: '06',
        countryCode: 'PE',
        level: 1,
        slug: 'cajamarca',
        name: 'Cajamarca',
        isoCode: 'PE-CAJ',
        centroid: { lng: -78.5128, lat: -7.1611 },
    }, // capital: Cajamarca
    {
        ubigeo: '07',
        countryCode: 'PE',
        level: 1,
        slug: 'callao',
        name: 'Callao',
        isoCode: 'PE-CAL',
        centroid: { lng: -77.1181, lat: -12.0566 },
    }, // Provincia Constitucional; capital: Callao
    {
        ubigeo: '08',
        countryCode: 'PE',
        level: 1,
        slug: 'cusco',
        name: 'Cusco',
        isoCode: 'PE-CUS',
        centroid: { lng: -71.9675, lat: -13.532 },
    }, // capital: Cusco
    {
        ubigeo: '09',
        countryCode: 'PE',
        level: 1,
        slug: 'huancavelica',
        name: 'Huancavelica',
        isoCode: 'PE-HUV',
        centroid: { lng: -74.9742, lat: -12.7867 },
    }, // capital: Huancavelica
    {
        ubigeo: '10',
        countryCode: 'PE',
        level: 1,
        slug: 'huanuco',
        name: 'Huánuco',
        isoCode: 'PE-HUC',
        centroid: { lng: -76.2422, lat: -9.9306 },
    }, // capital: Huánuco
    {
        ubigeo: '11',
        countryCode: 'PE',
        level: 1,
        slug: 'ica',
        name: 'Ica',
        isoCode: 'PE-ICA',
        centroid: { lng: -75.7286, lat: -14.0678 },
    }, // capital: Ica
    {
        ubigeo: '12',
        countryCode: 'PE',
        level: 1,
        slug: 'junin',
        name: 'Junín',
        isoCode: 'PE-JUN',
        centroid: { lng: -75.2049, lat: -12.0651 },
    }, // capital: Huancayo
    {
        ubigeo: '13',
        countryCode: 'PE',
        level: 1,
        slug: 'la-libertad',
        name: 'La Libertad',
        isoCode: 'PE-LAL',
        centroid: { lng: -79.0288, lat: -8.1116 },
    }, // capital: Trujillo
    {
        ubigeo: '14',
        countryCode: 'PE',
        level: 1,
        slug: 'lambayeque',
        name: 'Lambayeque',
        isoCode: 'PE-LAM',
        centroid: { lng: -79.8408, lat: -6.7711 },
    }, // capital: Chiclayo
    // 15: Lima — already seeded by migration 0000.
    {
        ubigeo: '16',
        countryCode: 'PE',
        level: 1,
        slug: 'loreto',
        name: 'Loreto',
        isoCode: 'PE-LOR',
        centroid: { lng: -73.2538, lat: -3.7491 },
    }, // capital: Iquitos
    {
        ubigeo: '17',
        countryCode: 'PE',
        level: 1,
        slug: 'madre-de-dios',
        name: 'Madre de Dios',
        isoCode: 'PE-MDD',
        centroid: { lng: -69.1893, lat: -12.5933 },
    }, // capital: Puerto Maldonado
    {
        ubigeo: '18',
        countryCode: 'PE',
        level: 1,
        slug: 'moquegua',
        name: 'Moquegua',
        isoCode: 'PE-MOQ',
        centroid: { lng: -70.9352, lat: -17.1949 },
    }, // capital: Moquegua
    {
        ubigeo: '19',
        countryCode: 'PE',
        level: 1,
        slug: 'pasco',
        name: 'Pasco',
        isoCode: 'PE-PAS',
        centroid: { lng: -76.2566, lat: -10.6878 },
    }, // capital: Cerro de Pasco
    {
        ubigeo: '20',
        countryCode: 'PE',
        level: 1,
        slug: 'piura',
        name: 'Piura',
        isoCode: 'PE-PIU',
        centroid: { lng: -80.6328, lat: -5.1945 },
    }, // capital: Piura
    {
        ubigeo: '21',
        countryCode: 'PE',
        level: 1,
        slug: 'puno',
        name: 'Puno',
        isoCode: 'PE-PUN',
        centroid: { lng: -70.0219, lat: -15.8402 },
    }, // capital: Puno
    {
        ubigeo: '22',
        countryCode: 'PE',
        level: 1,
        slug: 'san-martin',
        name: 'San Martín',
        isoCode: 'PE-SAM',
        centroid: { lng: -76.9722, lat: -6.0339 },
    }, // capital: Moyobamba
    {
        ubigeo: '23',
        countryCode: 'PE',
        level: 1,
        slug: 'tacna',
        name: 'Tacna',
        isoCode: 'PE-TAC',
        centroid: { lng: -70.2463, lat: -18.0066 },
    }, // capital: Tacna
    {
        ubigeo: '24',
        countryCode: 'PE',
        level: 1,
        slug: 'tumbes',
        name: 'Tumbes',
        isoCode: 'PE-TUM',
        centroid: { lng: -80.4515, lat: -3.566 },
    }, // capital: Tumbes
    {
        ubigeo: '25',
        countryCode: 'PE',
        level: 1,
        slug: 'ucayali',
        name: 'Ucayali',
        isoCode: 'PE-UCA',
        centroid: { lng: -74.5539, lat: -8.3791 },
    }, // capital: Pucallpa
];

export async function seed(database: typeof defaultDb = defaultDb): Promise<{
    inserted: number;
    skipped: number;
}> {
    return database.transaction(async (tx) => {
        const result = await tx
            .insert(regions)
            .values(
                PERU_LEVEL_1_ROWS.map((r) => ({
                    countryCode: r.countryCode,
                    level: r.level,
                    slug: r.slug,
                    name: r.name,
                    isoCode: r.isoCode,
                    centroid: r.centroid,
                    timezone: 'America/Lima',
                })),
            )
            .onConflictDoNothing({
                target: [regions.countryCode, regions.level, regions.slug],
            })
            .returning({ id: regions.id });

        return {
            inserted: result.length,
            skipped: PERU_LEVEL_1_ROWS.length - result.length,
        };
    });
}
