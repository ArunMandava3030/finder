import { normalizeLocalQuery } from './discovery.js';
import { rankPlaces } from '../../server/discovery/rank.mjs';
const queryFillers = new Set(['india', 'in', 'near', 'around', 'the', 'and', 'to', 'of', 'travel', 'places', 'place', 'underrated', 'most', 'find', 'all', 'hidden', 'quiet', 'quieter', 'least', 'less', 'populated', 'crowded', 'crowds', 'crowd', 'uncrowded', 'peaceful', 'secluded', 'touristy', 'tourists', 'tourist', 'non', 'busy', 'low', 'density', 'spots', 'spot']);
const crowdOrder = { quieter: 0, mixed: 1, unknown: 2, busy: 3 };
const crowdLevels = { very_low: 0, low: 1, moderate: 2, high: 3 };
const normalize = value => normalizeLocalQuery(String(value || '')).normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const stateAliases = {
  'andhra pradesh': ['ap'], 'arunachal pradesh': [], 'himachal pradesh': ['hp'],
  'madhya pradesh': ['mp'], 'tamil nadu': ['tamilnadu', 'tn'], 'uttar pradesh': ['up'],
  'west bengal': ['wb'], 'uttarakhand': ['uttaranchal'], 'odisha': ['orissa'],
  'puducherry': ['pondicherry'], 'jammu and kashmir': ['jammu kashmir', 'j k'],
  'andaman and nicobar islands': ['andaman', 'andamans', 'andaman nicobar'],
};
const wordsFor = text => normalize(text).split(' ').filter(word => word.length > 1 && !queryFillers.has(word));
const aliasesFor = destination => [destination.id, destination.city, destination.wikivoyageTitle, ...(destination.aliases || [])].map(normalize).filter(Boolean);
const statesFor = destination => [normalize(destination.state), ...(stateAliases[normalize(destination.state)] || [])].filter(Boolean);
const containsPhrase = (text, phrase) => (` ${text} `).includes(` ${phrase} `);
const placeText = place => normalize([place.name, ...(place.aliases || []), place.description, ...(place.tags || []), place.category].join(' '));

function locationScope(destinations, query) {
  const text = normalize(query);
  const cities = destinations.filter(destination => aliasesFor(destination).some(alias => containsPhrase(text, alias)));
  const states = destinations.filter(destination => statesFor(destination).some(alias => containsPhrase(text, alias)));
  const matched = cities.length && states.length ? cities.filter(city => states.some(state => state.id === city.id)) : cities.length ? cities : states;
  let remainder = ` ${text} `;
  const phrases = [...new Set([...cities.flatMap(aliasesFor), ...states.flatMap(statesFor)])].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) remainder = remainder.replaceAll(` ${phrase} `, ' ');
  return { matched, hasLocation: Boolean(cities.length || states.length), words: wordsFor(remainder) };
}

/** Remove discovery intent while preserving the location requested for a public guide lookup. */
export function normalizeIndiaQuery(query) {
  return wordsFor(query).join(' ');
}

export function compareCrowdEvidence(a, b) {
  const status = (crowdOrder[a.crowd?.status] ?? 2) - (crowdOrder[b.crowd?.status] ?? 2);
  return status || (crowdLevels[a.crowd?.level] ?? 4) - (crowdLevels[b.crowd?.level] ?? 4)
    || Number(b.crowd?.confidence === 'medium') - Number(a.crowd?.confidence === 'medium')
    || (b.discovery?.score || 0) - (a.discovery?.score || 0) || a.name.localeCompare(b.name);
}

/** Keep saved record IDs while combining source provenance and reassessing conflicting crowd claims. */
export function mergeDiscoveryResults(indexed, live = []) {
  return rankPlaces([...indexed, ...live]);
}

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
      .map(place => ({ ...place, sources: place.sources.filter(source => safeSourceUrl(source.url)), crowd: place.crowd ? { ...place.crowd, evidence: (place.crowd.evidence || []).filter(item => safeSourceUrl(item.url)) } : { status: 'unknown', evidence: [] } })),
    discussions: (data.discussions || []).filter(item => safeSourceUrl(item.url)),
  };
}

export function destinationsForQuery(destinations, query, places = []) {
  if (!wordsFor(query).length) return destinations;
  const { matched, hasLocation, words } = locationScope(destinations, query);
  if (hasLocation) return matched;
  const ids = new Set(places.filter(place => words.every(word => placeText(place).includes(word))).map(place => place.destinationId));
  return destinations.filter(destination => ids.has(destination.id));
}

export function selectIndexPlaces(data, { query = '', destinationId = '', category = 'all', crowdMode = 'quieter', offbeatOnly = false } = {}) {
  const { matched, hasLocation, words } = locationScope(data.destinations, query);
  const ids = new Set((hasLocation ? matched : data.destinations).map(destination => destination.id));
  return data.places.filter(place => ids.has(place.destinationId)
    && (!destinationId || place.destinationId === destinationId)
    && (category === 'all' || place.category === category)
    && (crowdMode === 'all' || (place.crowd?.status || 'unknown') === crowdMode)
    && (!offbeatOnly || place.discovery?.label === 'Offbeat signal found')
    && words.every(word => placeText(place).includes(word)))
    .sort(compareCrowdEvidence);
}

export function formatSourceDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown';
}
