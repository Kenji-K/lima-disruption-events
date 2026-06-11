import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { closeDb } from '@disruption-intelligence/db';
import { log } from '../log';
import { parseImportFile, importEvents } from './import-events';

/** `pnpm -F api import-events <file.json|file.csv>` — manual event import
 *  through the standard validate→upsert pipeline (see import-events.ts).
 *  (Not `import`: pnpm shadows that with its lockfile-importer builtin.) */

const path = process.argv[2];
if (!path || !/\.(json|csv)$/i.test(path)) {
    log.error({ path }, 'usage: pnpm -F api import-events <file.json|file.csv>');
    process.exit(2);
}

try {
    const format = path.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
    const rows = parseImportFile(readFileSync(path, 'utf8'), format, basename(path));
    const result = await importEvents(rows);
    for (const dup of result.suppressed) {
        log.warn(dup, 'import: cross-channel duplicate suppressed (ADR-009)');
    }
    log.info(
        {
            file: basename(path),
            sourceId: result.sourceId,
            rows: rows.length,
            inserted: result.inserted,
            updated: result.updated,
            suppressed: result.suppressed.length,
        },
        'import complete',
    );
} catch (err) {
    log.error({ err }, 'import failed — nothing partially written beyond the reported counts');
    process.exitCode = 1;
} finally {
    await closeDb();
}
