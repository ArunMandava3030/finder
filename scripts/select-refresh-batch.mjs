import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { destinations } from '../server/discovery/destinations.mjs';

const asTime = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/** Oldest attempts rotate even failing providers; scraper dates cannot postpone Wiki/OSM. */
export function selectRefreshBatch(catalog, previous, registry, { limit = 20, sourceLimit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || !Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 30) throw new Error('Invalid refresh batch limits.');
  const records = new Map((previous?.destinations || []).map(record => [record.id, record]));
  const sourceRecords = new Map((previous?.scraping?.sources || []).map(record => [record.id, record]));
  const attempted = destination => {
    const record = records.get(destination.id);
    if (record?.collectionAttemptedAt) return asTime(record.collectionAttemptedAt);
    const providers = (record?.providers || []).filter(provider => ['wikivoyage', 'osm'].includes(provider.provider));
    return providers.length ? Math.max(...providers.map(provider => asTime(provider.attemptedAt || provider.fetchedAt))) : 0;
  };
  const oldest = (values, date) => [...values].sort((a, b) => date(a) - date(b) || a.id.localeCompare(b.id));
  const sourceAttempted = source => asTime(sourceRecords.get(source.id)?.attemptedAt || sourceRecords.get(source.id)?.fetchedAt);
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    destinationIds: oldest(catalog, attempted).slice(0, limit).map(item => item.id),
    sourceIds: oldest((registry?.sources || []).filter(source => source.enabled !== false), sourceAttempted).slice(0, sourceLimit).map(item => item.id),
  };
}

export function validateRefreshBatch(batch, catalog) {
  const known = new Set(catalog.map(item => item.id));
  if (batch?.schemaVersion !== 1 || !Array.isArray(batch.destinationIds) || batch.destinationIds.length > 25 || new Set(batch.destinationIds).size !== batch.destinationIds.length || batch.destinationIds.some(id => !known.has(id))) throw new Error('Invalid refresh destination batch.');
  return batch.destinationIds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const target = option('--output', '.local/refresh-batch.json');
  let previous = {};
  try { previous = JSON.parse(await readFile(option('--index', 'public/data/india-index.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const registry = JSON.parse(await readFile('data/scrapling-sources.json', 'utf8'));
  const batch = selectRefreshBatch(destinations, previous, registry, { limit: Number(option('--limit', 20)), sourceLimit: Number(option('--source-limit', 20)) });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(batch, null, 2));
  console.log(`Prepared ${batch.destinationIds.length} destination refreshes and ${batch.sourceIds.length} reviewed source refreshes.`);
}
