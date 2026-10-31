const hiddenLanguage = /\b(hidden gems?|off[ -]?beat|lesser[ -]?known|little[ -]?known|uncrowded|secluded|quiet|less[ -]?visited|underrated)\b/gi;
const mainstreamLanguage = /\b((?:(?:very|most|extremely)\s+)?popular|major tourist|(?:world[ -]?)?famous|well[ -]?known|iconic landmark|(?:(?:usually|often|very)\s+)?crowded|heavily visited|tourist hotspot)\b/gi;
const natureCategories = new Set(['Nature', 'Trails', 'Beaches']);
const normalizeName = value => typeof value === 'string' ? value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
const genericNameWords = new Set('the of and at in a an sri shri shree sree swami swamy maa temple mandir devalaya devasthanam beach cove waterfall waterfalls falls viewpoint view point sunset sunrise park garden gardens church mosque masjid fort palace museum lake river hill hills shiva siva hanuman ganesh ganesha god goddess ram rama krishna durga vishnu devi deva'.split(' '));
const validCoordinates = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;

function affirmedPhrase(value, pattern) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[’‘]/g, "'");
  for (const match of text.matchAll(pattern)) {
    // Negation carries through an enumeration, but a contrasting clause starts a new claim.
    const before = text.slice(0, match.index).split(/[.!?;:\n]|\b(?:however|although|though|yet|whereas)\b|(?<!anything\s)(?<!nothing\s)\bbut\b/i).at(-1);
    const context = before.replace(/\bnot\s+(?:only|just|merely)\b/gi, '').trim().split(/\s+/).slice(-8).join(' ');
    if (/\b(?:not|no|never|neither|nor|hardly|rarely|seldom|without|isn't|aren't|wasn't|weren't|isnt|arent|wasnt|werent|don't|doesn't|didn't|cannot|can't|couldn't)\b/i.test(context)) continue;
    if (/\b(?:anything but|far from|less|lesser|once|formerly|previously|used to be)\b[^.!?;:]*$/i.test(context)) continue;
    return { phrase: match[0].toLowerCase(), index: match.index };
  }
  return null;
}

function aliasesFor(place, additions = []) {
  const names = new Map();
  for (const alias of [...(Array.isArray(place.aliases) ? place.aliases : []), ...additions]) {
    const normalized = normalizeName(alias);
    if (normalized && normalized !== normalizeName(place.name) && !names.has(normalized)) names.set(normalized, alias.trim());
  }
  return [...names.values()];
}

function featureType(name) {
  const groups = [
    ['temple', /\b(?:temple|mandir|devalaya|devasthanam)\b/], ['church', /\bchurch\b/], ['mosque', /\b(?:mosque|masjid)\b/],
    ['viewpoint', /\b(?:viewpoint|view point|sunset point|sunrise point)\b/], ['beach', /\b(?:beach|cove)\b/],
    ['waterfall', /\b(?:waterfalls?|falls)\b/], ['museum', /\bmuseum\b/], ['fort', /\bfort\b/], ['palace', /\bpalace\b/],
  ];
  return groups.find(([, pattern]) => pattern.test(name))?.[0] || null;
}

function distinctiveWords(name) {
  return [...new Set(name.split(' ').filter(word => !genericNameWords.has(word)))].sort().join(' ');
}

function placeDescription(place) {
  const description = typeof place.description === 'string' ? place.description.trim() : '';
  const factual = /^Listed by .+\. Open the original source for place details and current visitor information\.$/.test(description);
  const sources = Array.isArray(place.sources) ? place.sources : [];
  const excerpt = sources.find(source => source.provider !== 'scrapling' && typeof source.excerpt === 'string' && source.excerpt.trim())?.excerpt;
  // Restore a real source description if a previously merged snapshot kept the generic listing notice.
  if ((!description || factual) && excerpt) return { text: excerpt, factual: false };
  return { text: description, factual: factual || (sources.length > 0 && sources.every(source => source.provider === 'scrapling')) };
}

function distance(a, b) {
  if (!validCoordinates(a) || !validCoordinates(b)) return Infinity;
  const rad = Math.PI / 180;
  const lat = (b.lat - a.lat) * rad;
  const lon = (b.lng - a.lng) * rad;
  const hav = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, hav)), Math.sqrt(Math.max(0, 1 - hav)));
}

export function mergePlaces(input) {
  const merged = [];
  for (const place of input) {
    if (typeof place?.name !== 'string' || !place.destinationId || !Array.isArray(place.sources)) continue;
    const name = normalizeName(place.name);
    if (!name || name.length < 3) continue;
    const existing = merged.find(item => {
      if (item.destinationId !== place.destinationId) return false;
      const otherName = normalizeName(item.name);
      const separation = distance(item.coordinates, place.coordinates);
      // A provider's stable id is stronger evidence than a similar title, but never bridges cities.
      if (place.id && item.id === place.id) return true;
      const sameName = otherName === name;
      const distinctive = distinctiveWords(name);
      if (sameName) {
        // Common titles such as Shiva Temple need close coordinates; the same deity can have many temples.
        if (!distinctive) return separation < 60;
        return !validCoordinates(item.coordinates) || !validCoordinates(place.coordinates) || separation < 300;
      }
      const aliasMatch = aliasesFor(item).some(alias => normalizeName(alias) === name) || aliasesFor(place).some(alias => normalizeName(alias) === otherName);
      if (aliasMatch) return !validCoordinates(item.coordinates) || !validCoordinates(place.coordinates) || separation < 300;
      const itemType = featureType(otherName);
      const placeType = featureType(name);
      if (itemType && placeType && itemType !== placeType) return false;
      // Honorific/feature variants may match; broad token overlap can combine different nearby temples.
      return Boolean(distinctive) && distinctive === distinctiveWords(otherName) && separation < 150;
    });
    if (!existing) {
      merged.push({ ...place, description: placeDescription(place).text, aliases: aliasesFor(place), sources: [...place.sources] });
      continue;
    }
    existing.aliases = aliasesFor(existing, [place.name, ...(Array.isArray(place.aliases) ? place.aliases : [])]);
    existing.coordinates ||= place.coordinates;
    const previousDescription = placeDescription(existing);
    const incomingDescription = placeDescription(place);
    if (incomingDescription.text && (!previousDescription.text || (previousDescription.factual && !incomingDescription.factual) || (previousDescription.factual === incomingDescription.factual && incomingDescription.text.length > previousDescription.text.length))) existing.description = incomingDescription.text;
    existing.tags = [...new Set([...(existing.tags || []), ...(place.tags || [])])];
    existing.sources = [...new Map([...existing.sources, ...place.sources].map(source => [source.url, source])).values()];
    if (['Other', 'Attractions'].includes(existing.category)) existing.category = place.category;
  }
  return merged;
}

export function rankPlace(place) {
  // This is an explained discovery heuristic, never a visitor rating or proof of obscurity.
  const sources = (place.sources || []).filter(source => source && typeof source === 'object');
  const guideSources = sources.filter(source => (source.kind === 'guide' || source.kind === 'web') && typeof source.excerpt === 'string' && source.excerpt.trim());
  const hidden = guideSources.map(source => ({ source, match: affirmedPhrase(source.excerpt, hiddenLanguage) })).find(item => item.match);
  const mainstream = guideSources.map(source => ({ source, match: affirmedPhrase(source.excerpt, mainstreamLanguage) })).find(item => item.match);
  const publishers = new Set(sources.map(source => typeof source.publisher === 'string' ? source.publisher.trim().toLowerCase() : '').filter(Boolean));
  let value = 30;
  const reasons = [];
  if (natureCategories.has(place.category)) { value += 12; reasons.push('Natural landscape or walking destination'); }
  if (validCoordinates(place.coordinates)) { value += 8; reasons.push('Mapped location available'); }
  if (publishers.size >= 2) { value += 10; reasons.push('Corroborated by more than one data source'); }
  if (guideSources.length) { value += 5; reasons.push('Community travel description available'); }
  if (hidden) { value += 25; reasons.push(`A source describes it as ${hidden.match.phrase}`); }
  if (mainstream) { value -= 25; reasons.push(`A source describes it as ${mainstream.match.phrase}`); }
  return {
    ...place,
    discovery: {
      score: Math.max(0, Math.min(100, value)),
      label: hidden && !mainstream ? 'Offbeat signal found' : mainstream ? 'Established attraction' : 'Worth investigating',
      confidence: hidden && publishers.size >= 2 && !mainstream ? 'medium' : 'low',
      reasons,
      evidenceUrl: hidden?.source.url || mainstream?.source.url || null,
      explanation: 'Discovery fit is a transparent rule-based estimate. It is not a rating, popularity measurement, or a verified claim that a place is hidden.',
    },
    reviewSummary: { count: 0, rating: null, status: 'not_available' },
  };
}

export const rankPlaces = places => mergePlaces(places).map(rankPlace).sort((a, b) => b.discovery.score - a.discovery.score || a.name.localeCompare(b.name));

export function attachEvidence(places, items) {
  return places.map(place => {
    const names = [place.name, ...(place.aliases || [])].map(normalizeName);
    const matches = items.filter(item => {
      const text = normalizeName(`${item.title || ''} ${item.text || ''}`);
      return names.some(name => name.length >= 5 && text.includes(name));
    });
    return { ...place, evidence: [...new Map(matches.map(item => [item.url, item])).values()].slice(0, 6) };
  });
}
