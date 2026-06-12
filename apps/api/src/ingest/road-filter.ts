/** Road-disruption gates shared by the news-shaped scrapers (MML, gob.pe).
 *
 *  Tuned against reality twice: 2026-06-11 on live fixture batches (the brief's
 *  bare keyword list measured ~80% FP), then re-tuned the same day against a
 *  60-day replay of real post history (ADR-011; harness: `pnpm -F api
 *  audit-gates`). Three gates run on top of each other:
 *
 *  1. TRIGGER — one shared disruption vocabulary (ADR-011 unified the per-source
 *     lists). 'clausura*' is deliberately ABSENT: in institutional usage it means
 *     administrative shutdown of premises (discotecas, cocheras, CITVs) — 4/4
 *     clausura-only extractions in the 60-day window were false positives. The
 *     third-person present forms (cierran, desvian…) are deliberately PRESENT:
 *     their absence cost a real Vía Expresa closure.
 *  2. CONCRETE road infrastructure context — 'vía(s)'/'obra(s)' deliberately
 *     excluded (every municipal post can mention them; MML's own footer
 *     address "Av. 28 de Julio" is also why gate 3 exists). Multiword artery
 *     shapes ('vía expresa', 'paso a desnivel') ARE included.
 *  3. PROXIMITY — a trigger within TRIGGER_CONTEXT_WINDOW chars of a road term
 *     ("cierre de la avenida Abancay" passes; 'cierre' in paragraph one plus
 *     an address in the footer does not).
 *
 *  A fourth, post-extraction gate (the ADR-011 date-past guard) lives in the
 *  scrapers: a window that ends before the post's publication date is a report
 *  about the past, not an announcement. Keyword-positive posts rejected by
 *  gates 2–4 are quarantined (ingest_quarantine), never silently dropped.
 *
 *  All regexes run on normalize()d text: lowercased, diacritics stripped. */

/** Shared disruption-trigger vocabulary (ADR-011). */
export const DISRUPTION_TRIGGER_RE =
    /\b(cierres?|cierran?|cerrad[oa]s?|cerraran?|cortes?|cortan|desvios?|desvian?|desviaran?|interferencias?|restriccion(?:es)?|restringid[oa]s?|restringen?|interrumpid[oa]s?|interrumpen?|suspension(?:es)?|suspendid[oa]s?|suspenden?|suspenderan?)\b/g;

/** Matched trigger forms that announce a closure (vs works/restrictions).
 *  Tested against normalized matched keywords, not raw text. */
export const CLOSURE_KEYWORD_RE = /^(cierr|cerrad|cerrar|cort|desvi|interrump)/;

export const ROAD_CONTEXT_RE =
    /\b(av(?:enida)?s?\.|avenidas?\b|jr\.|jiron(?:es)?\b|calles?\b|puentes?\b|ovalos?\b|carreteras?\b|autopistas?\b|malecon(?:es)?\b|paseos?\b|transito\b|vehicular(?:es)?\b|peatonal(?:es)?\b|vias? expresas?\b|carril(?:es)?\b|tunel(?:es)?\b|paso a desnivel\b)/g;

export const TRIGGER_CONTEXT_WINDOW = 150;

/** Road-name mentions for sourcePayload (debugging + future geocoding input). */
export const ROAD_MENTION_RE =
    /(?:av(?:enida)?\.?|jr\.?|jir[oó]n|calle|puente|[oó]valo|malec[oó]n|carretera|autopista|paseo|t[uú]nel)\s+[A-ZÁÉÍÓÚÑ0-9][^,.;:()\n<]{2,40}/g;

/** Applies the trigger + road-context + proximity gates over normalized text.
 *  Returns the deduped trigger keywords, or null with a reason for the
 *  caller's quarantine entry. matchAll clones the regex, so shared g-flag
 *  instances are safe here. */
export function matchRoadDisruption(
    norm: string,
    triggerRe: RegExp = DISRUPTION_TRIGGER_RE,
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
