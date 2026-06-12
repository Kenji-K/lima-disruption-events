/** Rule-based Spanish date extraction shared by the news-shaped scrapers (MML,
 *  Lima Expresa). No ML/NER per the v1 fence — regex patterns over normalized
 *  text, post-date-anchored year inference. */

export type PlainDate = { y: number; m: number; d: number };
export type DateRange = { start: PlainDate; end?: PlainDate; raw: string };

const MONTHS: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
};
const MONTH = `(${Object.keys(MONTHS).join('|')})`;

export const normalize = (text: string): string =>
    // Strip combining diacritics (U+0300–U+036F) after NFD: 'vía' → 'via'.
    text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const isRealDate = ({ y, m, d }: PlainDate): boolean => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** ADR-011 date-past guard: true when the range's last day is strictly before
 *  `day` — the post reports something past instead of announcing it. */
export const rangeEndsBefore = (range: DateRange, day: PlainDate): boolean => {
    const end = range.end ?? range.start;
    return Date.UTC(end.y, end.m - 1, end.d) < Date.UTC(day.y, day.m - 1, day.d);
};

/** Lima is fixed UTC-5 (no DST): whole-day timestamps carry a -05:00 literal. */
export const toStartIso = ({ y, m, d }: PlainDate): string =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00-05:00`;
export const toEndIso = ({ y, m, d }: PlainDate): string =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:00-05:00`;

/** Full Spanish text date with explicit year — gob.pe's listing `date` field
 *  ("3 de junio de 2026", sometimes with a leading space). */
export function parseSpanishDate(text: string): PlainDate | null {
    const m = new RegExp(`(\\d{1,2})\\s+de\\s+${MONTH}\\s+de\\s+(\\d{4})`).exec(normalize(text));
    if (!m) return null;
    const date = { y: Number(m[3]), m: MONTHS[m[2]!]!, d: Number(m[1]) };
    return isRealDate(date) ? date : null;
}

/** Tries range patterns first, then "a partir del", then the first bare
 *  "N de MONTH". Years default to the post's year; a date landing >60 days
 *  BEFORE the post rolls forward one year (December post about January
 *  closures). Returns null when no pattern yields a real calendar date. */
export function extractDateRange(text: string, postDate: PlainDate): DateRange | null {
    const t = normalize(text);

    const resolveYear = (m: number, d: number, explicit?: string): number => {
        if (explicit) return Number(explicit);
        const y = postDate.y;
        const candidate = Date.UTC(y, m - 1, d);
        const post = Date.UTC(postDate.y, postDate.m - 1, postDate.d);
        return candidate < post - 60 * 86_400_000 ? y + 1 : y;
    };

    // "del 12 de junio al 15 de julio [de 2026]" / "desde el 12 de junio hasta el 15 de julio"
    const crossMonth = new RegExp(
        `(?:del|desde el)\\s+(\\d{1,2})\\s+de\\s+${MONTH}(?:\\s+de\\s+(\\d{4}))?\\s+(?:al|hasta el)\\s+(\\d{1,2})\\s+de\\s+${MONTH}(?:\\s+de\\s+(\\d{4}))?`,
    ).exec(t);
    if (crossMonth) {
        const [raw, d1, mon1, y1, d2, mon2, y2] = crossMonth;
        const m1 = MONTHS[mon1!]!;
        const m2 = MONTHS[mon2!]!;
        const start = { y: resolveYear(m1, Number(d1), y1), m: m1, d: Number(d1) };
        const end = { y: y2 ? Number(y2) : resolveYear(m2, Number(d2), y1), m: m2, d: Number(d2) };
        if (isRealDate(start) && isRealDate(end)) return { start, end, raw };
    }

    // "del 12 al 15 de junio [de 2026]"
    const sameMonth = new RegExp(
        `del\\s+(\\d{1,2})\\s+al\\s+(\\d{1,2})\\s+de\\s+${MONTH}(?:\\s+de\\s+(\\d{4}))?`,
    ).exec(t);
    if (sameMonth) {
        const [raw, d1, d2, mon, y] = sameMonth;
        const m = MONTHS[mon!]!;
        const start = { y: resolveYear(m, Number(d1), y), m, d: Number(d1) };
        const end = { ...start, d: Number(d2) };
        if (isRealDate(start) && isRealDate(end)) return { start, end, raw };
    }

    // "a partir del 12 de junio [de 2026]" — open-ended start
    const openStart = new RegExp(
        `a partir del\\s+(\\d{1,2})\\s+de\\s+${MONTH}(?:\\s+de\\s+(\\d{4}))?`,
    ).exec(t);
    if (openStart) {
        const [raw, d, mon, y] = openStart;
        const m = MONTHS[mon!]!;
        const start = { y: resolveYear(m, Number(d), y), m, d: Number(d) };
        if (isRealDate(start)) return { start, raw };
    }

    // first bare "12 de junio [de(l) 2026]"
    const single = new RegExp(`\\b(\\d{1,2})\\s+de\\s+${MONTH}(?:\\s+del?\\s+(\\d{4}))?`).exec(t);
    if (single) {
        const [raw, d, mon, y] = single;
        const m = MONTHS[mon!]!;
        const start = { y: resolveYear(m, Number(d), y), m, d: Number(d) };
        if (isRealDate(start)) return { start, raw };
    }

    return null;
}
