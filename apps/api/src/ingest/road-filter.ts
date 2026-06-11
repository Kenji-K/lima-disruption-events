/** Road-disruption gates shared by the news-shaped scrapers (MML, gob.pe).
 *  Each source owns its TRIGGER vocabulary (MML's is precision-tuned against
 *  its own feed; gob.pe adds ATU/SUTRAN operational verbs) — what they share
 *  is the road-context + proximity discipline that kills the false positives.
 *
 *  Tuned against reality on 2026-06-11 (the brief explicitly invites tuning).
 *  The brief's bare keyword list produced ~80% false positives on live MML
 *  fixtures: 'obras' matches public works *and* books, 'vía(s)' is municipal
 *  boilerplate, "cierre de campañas electorales" sails through. Hence two
 *  gates on top of the trigger:
 *
 *  1. CONCRETE road infrastructure context — 'vía(s)'/'obra(s)' deliberately
 *     excluded (every municipal post can mention them; MML's own footer
 *     address "Av. 28 de Julio" is also why gate 2 exists);
 *  2. PROXIMITY — a trigger within TRIGGER_CONTEXT_WINDOW chars of a road term
 *     ("cierre de la avenida Abancay" passes; 'cierre' in paragraph one plus
 *     an address in the footer does not).
 *
 *  All regexes run on normalize()d text: lowercased, diacritics stripped. */

export const ROAD_CONTEXT_RE =
    /\b(av(?:enida)?s?\.|avenidas?\b|jr\.|jiron(?:es)?\b|calles?\b|puentes?\b|ovalos?\b|carreteras?\b|autopistas?\b|malecon(?:es)?\b|paseos?\b|transito\b|vehicular(?:es)?\b|peatonal(?:es)?\b)/g;

export const TRIGGER_CONTEXT_WINDOW = 150;

/** Road-name mentions for sourcePayload (debugging + future geocoding input). */
export const ROAD_MENTION_RE =
    /(?:av(?:enida)?\.?|jr\.?|jir[oó]n|calle|puente|[oó]valo|malec[oó]n|carretera|autopista|paseo)\s+[A-ZÁÉÍÓÚÑ0-9][^,.;:()\n<]{2,40}/g;

/** Applies the trigger + road-context + proximity gates over normalized text.
 *  Returns the deduped trigger keywords, or null with a reason for the
 *  caller's debug log. matchAll clones the regex, so shared g-flag instances
 *  are safe here. */
export function matchRoadDisruption(
    norm: string,
    triggerRe: RegExp,
): { keywords: string[] } | { keywords: null; reason: 'no-trigger' | 'no-road-context' } {
    const triggers = [...norm.matchAll(triggerRe)];
    if (triggers.length === 0) return { keywords: null, reason: 'no-trigger' };

    const roadTerms = [...norm.matchAll(ROAD_CONTEXT_RE)];
    const proximate = triggers.some((trig) =>
        roadTerms.some((road) => Math.abs(road.index - trig.index) <= TRIGGER_CONTEXT_WINDOW),
    );
    if (!proximate) return { keywords: null, reason: 'no-road-context' };

    return { keywords: [...new Set(triggers.map((m) => m[1]!))] };
}
