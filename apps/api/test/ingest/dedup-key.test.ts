import { describe, it, expect } from 'vitest';
import { newsDedupKey } from '@disruption-intelligence/shared';

// ADR-009: the dedup key is our own slugification of the headline. The two
// assertions against real cross-channel pairs (verified 2026-06-11) are the
// load-bearing ones: WP shouts in caps, gob.pe uses sentence case, and both
// platforms' URL slugs equal our computed key.
describe('newsDedupKey', () => {
    it('produces the shared slug from the WP (all-caps) variant of a real comunicado', () => {
        expect(
            newsDedupKey(
                'NUEVO CORREDOR DE LA VÍA EXPRESA GRAU ALCANZA 90 % DE AVANCE E INICIARÁ MARCHA BLANCA EN 60 DÍAS, ANUNCIA ALCALDE REGGIARDO',
            ),
        ).toBe(
            'nuevo-corredor-de-la-via-expresa-grau-alcanza-90-de-avance-e-iniciara-marcha-blanca-en-60-dias-anuncia-alcalde-reggiardo',
        );
    });

    it('produces the identical key from the gob.pe (sentence-case) variant', () => {
        expect(
            newsDedupKey(
                'Nuevo corredor de la Vía Expresa Grau alcanza 90 % de avance e iniciará marcha blanca en 60 días, anuncia alcalde Reggiardo',
            ),
        ).toBe(
            'nuevo-corredor-de-la-via-expresa-grau-alcanza-90-de-avance-e-iniciara-marcha-blanca-en-60-dias-anuncia-alcalde-reggiardo',
        );
    });

    it('folds ñ/ü and strips inverted punctuation', () => {
        expect(newsDedupKey('¡Atención! Cierre por Año Nuevo en Güemes')).toBe(
            'atencion-cierre-por-ano-nuevo-en-guemes',
        );
    });

    it('collapses punctuation runs and trims edge hyphens', () => {
        expect(newsDedupKey('— Cierre total: Av. Abancay (tramo 1) —')).toBe(
            'cierre-total-av-abancay-tramo-1',
        );
    });

    it('returns empty string for an all-punctuation title (callers must guard)', () => {
        expect(newsDedupKey('¿¡—!?')).toBe('');
    });
});
