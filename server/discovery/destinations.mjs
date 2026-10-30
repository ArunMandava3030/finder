import { readFileSync } from 'node:fs';
import { normalizeLocalQuery } from '../../src/lib/discovery.js';

const raw = JSON.parse(readFileSync(new URL('../../data/india-destinations.json', import.meta.url), 'utf8'));
export const destinations = Array.isArray(raw) ? raw : raw.destinations;

export function resolveDestination(query) {
  if (typeof query !== 'string' || query.length > 160) return null;
  const normalized = normalizeLocalQuery(query).replace(/\b(?:in|near|around|india|reviews?|tips?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return destinations.find(destination => [destination.id, destination.city, ...(destination.aliases || [])].some(value => {
    const name = value.toLowerCase();
    return normalized === name || ` ${normalized} `.includes(` ${name} `);
  })) || null;
}
