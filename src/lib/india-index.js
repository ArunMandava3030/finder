import { normalizeLocalQuery } from './discovery.js';
const queryFillers = new Set(['india', 'in', 'near', 'around', 'the', 'and', 'to', 'of', 'travel', 'places', 'place', 'underrated', 'most', 'find', 'all', 'hidden']);

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validateIndex(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.destinations) || !Array.isArray(data.places) || data.places.length > 20000) {
    throw new Error('The place index is unavailable.');
  }
  return {
    ...data,
    places: data.places.filter(place => typeof place.name === 'string' && place.destinationId && Array.isArray(place.sources))
      .map(place => ({ ...place, sources: place.sources.filter(source => safeSourceUrl(source.url)) })),
    discussions: (data.discussions || []).filter(item => safeSourceUrl(item.url)),
  };
}

export function destinationsForQuery(destinations, query) {
  const text = ` ${normalizeLocalQuery(query)} `;
  if (!text.trim().split(/\s+/).some(word => word && !queryFillers.has(word))) return destinations;
  return destinations.filter(destination => [destination.id, destination.city, ...(destination.aliases || [])]
    .some(alias => text.includes(` ${normalizeLocalQuery(alias)} `)));
}

export function selectIndexPlaces(data, { query = '', destinationId = '', category = 'all', offbeatOnly = false } = {}) {
  const matched = destinationsForQuery(data.destinations, query);
  const ids = new Set(matched.map(destination => destination.id));
  // A city search can contain a specific place name: don't silently ignore those words.
  let remainder = ` ${normalizeLocalQuery(query)} `;
  for (const destination of matched) {
    for (const alias of [destination.city, destination.id, ...(destination.aliases || [])].sort((a, b) => b.length - a.length)) {
      remainder = remainder.replaceAll(` ${normalizeLocalQuery(alias)} `, ' ');
    }
  }
  const words = remainder.split(/\s+/).filter(word => word.length > 1 && !queryFillers.has(word));
  return data.places.filter(place => ids.has(place.destinationId)
    && (!destinationId || place.destinationId === destinationId)
    && (category === 'all' || place.category === category)
    && (!offbeatOnly || place.discovery?.label === 'Offbeat signal found')
    && words.every(word => `${place.name} ${place.description} ${(place.tags || []).join(' ')} ${place.category}`.toLowerCase().includes(word)))
    .sort((a, b) => (b.discovery?.score || 0) - (a.discovery?.score || 0) || a.name.localeCompare(b.name));
}

export function formatSourceDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown';
}
