import { closeDb } from '@disruption-intelligence/db';
import { log } from '../log';
import { runIngestOnce } from './run';

try {
    await runIngestOnce(log);
} finally {
    await closeDb();
}
