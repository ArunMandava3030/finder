const hiddenLanguage = /\b(hidden gems?|off[ -]?beat|lesser[ -]?known|little[ -]?known|uncrowded|secluded|quiet|less[ -]?visited|underrated)\b/gi;
const mainstreamLanguage = /\b((?:(?:very|most|extremely)\s+)?popular|major tourist|(?:world[ -]?)?famous|well[ -]?known|iconic landmark|(?:(?:usually|often|very)\s+)?crowded|heavily visited|tourist hotspot)\b/gi;
const natureCategories = new Set(['Nature', 'Trails', 'Beaches']);
const normalizeName = value => typeof value === 'string' ? value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
const genericNameWords = new Set('the of and at in a an sri shri shree sree swami swamy maa temple mandir devalaya devasthanam beach cove waterfall waterfalls falls viewpoint view point sunset sunrise park garden gardens church mosque masjid fort palace museum lake river hill hills shiva siva hanuman ganesh ganesha god goddess ram rama krishna durga vishnu devi deva'.split(' '));
const validCoordinates = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
const crowdOrder = { quieter: 0, mixed: 1, unknown: 2, busy: 3 };
const crowdLevels = { very_low: 0, low: 1, moderate: 2, high: 3 };
const quieterCrowd = /\b(?:uncrowded|unfrequented|deserted|(?:less|least|lightly|sparsely|rarely|seldom)[ -](?:crowded|visited|frequented)|(?:not|never|rarely|seldom|no longer)\s+(?:(?:very|so|as|particularly|usually|always|often)\s+)?crowded|(?:isn't|aren't|wasn't|weren't)\s+(?:very\s+)?crowded|(?:very\s+few|few(?:er)?|hardly any|not many|almost no|a handful of)\s+(?:other\s+)?(?:people|visitors|tourists|travellers|travelers)|(?:little|low|minimal|limited)\s+(?:crowding|crowds?|footfall|visitor numbers)|(?:no|without)\s+crowds?|not much\s+(?:of a\s+)?crowd|crowd[ -]free|(?:it|beach|place|cove|spot)\s+(?:all\s+)?to (?:ourselves|myself|yourself|themselves)|(?:very[ -]low|low)\s+crowd(?:\s+levels?)?)\b/gi;
const busierCrowd = /\b(?:overcrowded|crowded|heavily[ -]visited|heavily[ -]frequented|(?:large|big|huge)\s+crowds?|(?:lots of|many|numerous)\s+(?:people|visitors|tourists)|heavy\s+(?:footfall|crowding)|packed\s+with\s+(?:people|visitors|tourists)|high\s+crowd(?:\s+levels?)?|busy\s+(?:beach|cove|temple|attraction|place))\b/gi;
const timeCondition = /\b(?:weekends?|weekdays?|holidays?|festivals?|peak[ -]season|off[ -]season|high[ -]season|low[ -]season|monsoons?|summer|winter|mornings?|evenings?|afternoons?|sunrise|sunset|night|dawn|dusk|sometimes|occasionally|can be|may be|might be|only|except|unless|depending|when|if|during|early|late|avoid|not always)\b/i;
const partialArea = /\b(?:northern|southern|eastern|western|north|south|east|west|far|farther|further|remote)\s+(?:end|side|stretch|section|part)|\b(?:end|stretch|section|part)\s+of\b/i;

function evidenceUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function evidenceDate(value, now) {
  if (typeof value !== 'string') return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= now + 300_000 ? new Date(date).toISOString() : null;
}

function evidencePeriod(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return null;
  return value <= new Date(now).toISOString().slice(0, 7) ? value : null;
}

function crowdNegated(clause, index) {
  const prefix = clause.slice(0, index).replace(/\bnot\s+(?:only|just|merely)\b/gi, '').trim().split(/\s+/).slice(-7).join(' ');
  return /\b(?:not|no|never|neither|nor|hardly|isn't|aren't|wasn't|weren't|isnt|arent|doesn't|don't|cannot|can't)\b|\b(?:anything but|far from)\b/i.test(prefix);
}

function crowdSubjectMatches(place, clause, match) {
  const names = [place.name, ...(place.aliases || [])].map(normalizeName).filter(Boolean);
  const prefix = clause.slice(0, match.index);
  const normalizedPrefix = normalizeName(prefix);
  const hasTargetBefore = names.some(name => ` ${normalizedPrefix} `.includes(` ${name} `));
  const full = normalizeName(clause);
  const hasTarget = names.some(name => ` ${full} `.includes(` ${name} `));
  const after = normalizeName(clause.slice(match.index + match[0].length));
  const adjectiveNamesTarget = names.some(name => after === name || after.startsWith(`${name} `));
  const visitorsAtTarget = names.some(name => ['at', 'visit', 'visiting', 'on', 'in', 'come to'].some(prefix => after === `${prefix} ${name}` || after.startsWith(`${prefix} ${name} `)));
  // A comparison's object is not the place being described: "Half Moon is less crowded than Om Beach".
  if (hasTarget && !hasTargetBefore && !adjectiveNamesTarget && !visitorsAtTarget) return false;
  // An attraction's cafe, road or boat traffic cannot establish visitor numbers for the attraction.
  if (/\b(?:road|parking|car park|traffic|restaurant|caf[eé]|hotel|shop|bus|water|boats?|surf|waves?|facilities)\b/i.test(prefix) && !names.includes(normalizedPrefix)) return false;
  if (/^\s+(?:with|of)\s+(?:boats?|vehicles?|cars?|fish|buildings?)\b/i.test(clause.slice(match.index + match[0].length))) return false;
  // "Few visitors at Om Beach" belongs to Om even when copied into another place's listing.
  const visitorLocation = after.match(/^(?:at|visit|visiting|on|in|come to|go to)\s+(.+)$/)?.[1];
  if (visitorLocation && !visitorsAtTarget && !timeCondition.test(visitorLocation) && !/^(?:here|there|this (?:place|beach|cove)|the (?:place|beach|cove))(?:\s|$)/.test(visitorLocation)) return false;
  // Use the nearest subordinate subject; an earlier target name does not own "Calangute got crowded".
  const subjectPrefix = prefix.split(/[,;]|\b(?:after|before|because|while|where|than|like|unlike|near|outside|around)\b/i).at(-1).trim();
  const subject = subjectPrefix.match(/^(.*?)\s+(?:is|are|was|were|has|have|had|gets?|got|became|becomes?|remains?|seems?|sees?|attracts?|draws?|used to be|can be|may be|tends? to be)(?:\s+[^,]*)?$/i)?.[1];
  if (subject) {
    const normalized = normalizeName(subject);
    if (names.some(name => normalized === name || normalized === `the ${name}`)) return true;
    if (partialArea.test(subject) && names.some(name => ` ${normalized} `.includes(` ${name} `))) return true;
    const generic = /^(?:(?:this|the|a|an|that)\s+)?(?:it|beach|cove|place|attraction|spot|area|temple|park|trail|fort|lake|waterfall|island)(?:\s+(?:here|itself))?$/.test(normalized);
    if (!generic && normalized !== 'there') return false;
  }
  // An adjective immediately naming another beach/temple should not spill into this listing.
  const other = clause.slice(match.index + match[0].length).match(/^\s+([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*){0,4}\s+(?:Beach|Cove|Temple|Park|Fort|Lake|Island|Falls|Trail))\b/u)?.[1];
  if (other && !names.includes(normalizeName(other))) return false;
  return true;
}

function crowdClaims(place, value, { reviewed = false } = {}) {
  if (typeof value !== 'string') return [];
  const claims = [];
  const text = value.replace(/[’‘]/g, "'").slice(0, 5000);
  // Reject disputed prose instead of extracting an affirmative phrase from a refutation.
  if (/\b(?:claim|description|statement|report|assertion)\b[^.!?;\n]{0,220}\b(?:false|incorrect|wrong|misleading|untrue|unfounded|disputed|refuted)\b|\b(?:false|incorrect|misleading|unfounded)\s+(?:claim|description|statement|report)\b/i.test(text)) return [];
  const clauses = text.split(/[.!?;\n]+|\b(?:whereas|however|although|yet)\b|(?<!anything\s)(?<!nothing\s)\bbut\b/i).filter(Boolean).slice(0, 25);
  for (const raw of clauses) {
    const clause = raw.trim();
    const quieter = [...clause.matchAll(quieterCrowd)];
    const busy = [...clause.matchAll(busierCrowd)].filter(match => !quieter.some(quiet => match.index >= quiet.index && match.index < quiet.index + quiet[0].length));
    for (const [direction, matches] of [['quieter', quieter], ['busy', busy]]) {
      for (const match of matches) {
        if (crowdNegated(clause, match.index) || (!reviewed && !crowdSubjectMatches(place, clause, match))) continue;
        const historical = /\b(?:used to|formerly|previously|was|were|had been|in (?:19|20)\d{2})\b/i.test(clause);
        claims.push({ direction, claim: clause.slice(0, 360), conditional: timeCondition.test(clause) || partialArea.test(clause) || historical, historical });
        break;
      }
    }
  }
  return claims;
}

/** Descriptive source evidence, never a live headcount or an inference from sparse coverage. */
export function assessCrowd(place, { now = Date.now } = {}) {
  const currentTime = typeof now === 'function' ? now() : now;
  const candidates = [];
  for (const source of (place.sources || []).slice(0, 30)) {
    if (!source || !['guide', 'web'].includes(source.kind) || source.provider === 'scrapling') continue;
    for (const claim of crowdClaims(place, source.excerpt)) candidates.push({ ...claim, url: source.url, publisher: source.publisher, sourceUpdatedAt: source.listingUpdatedAt || source.updatedAt || source.publishedAt, publishedPeriod: source.publishedPeriod, retrievedAt: source.retrievedAt, sourceType: source.sourceType || 'guide' });
  }
  for (const record of (Array.isArray(place.crowdEvidence) ? place.crowdEvidence : []).slice(0, 20)) {
    if (!record || !['quieter', 'busy', 'mixed'].includes(record.direction)) continue;
    const structured = record.provider === 'scrapling' && Object.hasOwn(crowdLevels, record.level);
    const claims = structured ? [{ direction: record.direction, claim: record.claim, conditional: Boolean(record.conditional) }] : crowdClaims(place, record.claim, { reviewed: true });
    for (const claim of claims) candidates.push({ ...record, ...claim, conditional: Boolean(record.conditional || claim.conditional) });
  }
  const observations = [];
  for (const candidate of candidates) {
    const url = evidenceUrl(candidate.url);
    if (!url || typeof candidate.claim !== 'string' || !candidate.claim.trim()) continue;
    const sourceUpdatedAt = evidenceDate(candidate.sourceUpdatedAt, currentTime);
    const publishedPeriod = evidencePeriod(candidate.publishedPeriod, currentTime);
    const sourceMonth = publishedPeriod || sourceUpdatedAt?.slice(0, 7);
    const current = new Date(currentTime);
    const old = sourceMonth ? (current.getUTCFullYear() * 12 + current.getUTCMonth()) - (Number(sourceMonth.slice(0, 4)) * 12 + Number(sourceMonth.slice(5, 7)) - 1) > 24 : false;
    observations.push({
      url, publisher: typeof candidate.publisher === 'string' ? candidate.publisher.trim().slice(0, 160) : '',
      claim: candidate.claim.trim().slice(0, 360), direction: candidate.direction,
      sourceUpdatedAt, publishedPeriod, retrievedAt: evidenceDate(candidate.retrievedAt, currentTime),
      conditional: Boolean(candidate.conditional), stale: old, dateUnknown: !sourceMonth,
      ...(Object.hasOwn(crowdLevels, candidate.level) ? { level: candidate.level } : {}),
      ...(candidate.provider ? { provider: candidate.provider } : {}),
      ...(candidate.sourceId ? { sourceId: candidate.sourceId } : {}),
      ...(candidate.sourceType ? { sourceType: candidate.sourceType } : {}),
      ...(typeof candidate.context === 'string' ? { context: candidate.context.slice(0, 300) } : {}),
    });
  }
  const evidence = [...new Map(observations.map(item => [`${item.url}\n${item.direction}\n${item.claim}`, item])).values()];
  const directions = new Set(evidence.map(item => item.direction));
  const qualified = evidence.some(item => item.conditional || item.stale);
  const status = !evidence.length ? 'unknown' : directions.has('mixed') || directions.size > 1 || qualified ? 'mixed' : directions.has('quieter') ? 'quieter' : 'busy';
  const recent = evidence.filter(item => !item.conditional && !item.stale && !item.dateUnknown && item.publisher);
  const publishers = new Set(recent.map(item => item.publisher.toLowerCase()));
  const domains = new Set(recent.map(item => new URL(item.url).hostname.replace(/^www\./, '')));
  const confidence = ['quieter', 'busy'].includes(status) && publishers.size >= 2 && domains.size >= 2 ? 'medium' : 'low';
  const levels = evidence.map(item => item.level).filter(level => Object.hasOwn(crowdLevels, level));
  const level = levels.sort((a, b) => crowdLevels[b] - crowdLevels[a])[0] || null;
  const reasons = [];
  if (!evidence.length) reasons.push('No explicit, place-specific crowd evidence was found. Atmosphere, mapped locations and missing reviews do not establish visitor numbers.');
  else {
    if (directions.has('quieter')) reasons.push('A source explicitly describes fewer visitors or lower crowd levels.');
    if (directions.has('busy')) reasons.push('A source explicitly describes heavier visitor crowds.');
    if (directions.has('mixed')) reasons.push('The source describes moderate or mixed crowd levels.');
    if (directions.has('quieter') && directions.has('busy')) reasons.push('Sources or passages disagree about crowd levels.');
    if (evidence.some(item => item.conditional)) reasons.push('The crowd description depends on visiting time, historical context or a particular part of the place.');
    if (evidence.some(item => item.stale)) reasons.push('A crowd source is more than two years old; current conditions may differ.');
    if (evidence.some(item => item.dateUnknown)) reasons.push('The crowd claim has no known publication date; its retrieval date does not date the observation.');
    if (confidence === 'low') reasons.push('Limited source evidence; check current conditions before visiting.');
  }
  return { status, confidence, level, reasons, evidence: evidence.slice(0, 16), explanation: 'Crowd assessment uses explicit source claims about visitors. It is not a live headcount, a visitor rating, or proof that a place will be empty.' };
}

export function comparePlacesByCrowd(a, b) {
  return (crowdOrder[a.crowd?.status] ?? 2) - (crowdOrder[b.crowd?.status] ?? 2)
    || (crowdLevels[a.crowd?.level] ?? 4) - (crowdLevels[b.crowd?.level] ?? 4)
    || Number(b.crowd?.confidence === 'medium') - Number(a.crowd?.confidence === 'medium')
    || (b.discovery?.score || 0) - (a.discovery?.score || 0) || a.name.localeCompare(b.name);
}

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
    if (place.detailsSourceId && (!existing.detailsSourceId || existing.detailsSourceId === place.detailsSourceId)) {
      if (!existing.area || existing.detailsSourceId) existing.area = place.area;
      if (!existing.accessNotes || existing.detailsSourceId) existing.accessNotes = place.accessNotes;
      existing.detailsSourceId = place.detailsSourceId;
    }
    existing.sources = [...new Map([...existing.sources, ...place.sources].map(source => [source.url, source])).values()];
    if (Array.isArray(existing.crowdEvidence) || Array.isArray(place.crowdEvidence)) existing.crowdEvidence = [...new Map([...(existing.crowdEvidence || []), ...(place.crowdEvidence || [])].map(item => [`${item.provider || ''}:${item.sourceId || ''}:${item.url}:${item.claim}`, item])).values()];
    if (['Other', 'Attractions'].includes(existing.category)) existing.category = place.category;
  }
  return merged;
}

export function rankPlace(place, options = {}) {
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
    crowd: assessCrowd(place, options),
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

export const rankPlaces = (places, options = {}) => mergePlaces(places).map(place => rankPlace(place, options)).sort(comparePlacesByCrowd);

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
