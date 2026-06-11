/** ADR-009: cross-channel news dedup key — our own slugification of the
 *  headline. Both munlima.gob.pe (WordPress) and gob.pe embed this exact slug
 *  in their post URLs because both slugify the same press-office headline;
 *  computing it from the title (not parsing it out of URLs) keeps the key
 *  immune to either platform's URL-format drift.
 *
 *  Can return '' for degenerate all-punctuation titles — callers must guard
 *  (an empty dedupKey must be omitted, never stored). */
export function newsDedupKey(title: string): string {
    return title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
