/** Lima is UTC-5 year-round (no DST): shifting the epoch by -5h and reading
 *  the UTC calendar date yields the Lima calendar day. */
export function limaDateString(daysFromToday = 0): string {
    return new Date(Date.now() - 5 * 3_600_000 + daysFromToday * 86_400_000)
        .toISOString()
        .slice(0, 10);
}

/** Default view window: hoy → +30d (review G2/U2 — the map is a planning
 *  surface; leading with past events buried the product's value). Also
 *  deflects the 500-row silent-truncation cliff (A3) until real pagination. */
export const DEFAULT_WINDOW_DAYS = 30;
