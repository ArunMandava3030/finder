import { writeFile, mkdir } from 'node:fs/promises';
import { destinations } from '../server/discovery/destinations.mjs';

const target = process.argv[2] || '.local/discussion-queries.json';
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
await writeFile(target, JSON.stringify({ max_results: 5, queries: destinations.map(destination => ({ id: destination.id, query: `${destination.city} India hidden places travel experience`, source: 'reddit', freshness: 'year' })) }));
console.log(`Prepared ${destinations.length} destination discussion queries.`);
