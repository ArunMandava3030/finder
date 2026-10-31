import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { destinations } from '../server/discovery/destinations.mjs';
import { validateRefreshBatch } from './select-refresh-batch.mjs';

const args = process.argv.slice(2);
const batchAt = args.indexOf('--batch');
const batchIds = batchAt >= 0 ? validateRefreshBatch(JSON.parse(await readFile(args[batchAt + 1], 'utf8')), destinations) : null;
const selected = batchIds ? destinations.filter(destination => batchIds.includes(destination.id)) : destinations;
const target = args[0] && !args[0].startsWith('--') ? args[0] : '.local/discussion-queries.json';
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({ max_results: 5, queries: selected.map(destination => ({ id: destination.id, query: `${destination.city} India less crowded places travel experience`, source: 'reddit', freshness: 'year' })) }));
console.log(`Prepared ${selected.length} destination discussion queries.`);
