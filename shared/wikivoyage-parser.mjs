const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PLACES = 60;
const EXCLUDED_TYPES = new Set(['eat', 'drink', 'sleep', 'buy', 'listing city', 'listing hotel']);
const PRIVATE_ACCESS = /\b(?:private property|private access|no public access|not open to (?:the )?public|closed to (?:the )?public|permanently closed|closed permanently|entry (?:is )?prohibited|members[ -]only|non-\w+ are not welcome)\b/i;

function stableNameHash(value) {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isNonPlaceName(name) {
  if (typeof name !== 'string') return true;
  const value = name.trim().replace(/[:;,]+$/, '');
  if (/\b(?:festivals?|events?|fairs?|carnival|christmas|diwali|eid|chaturthi|janmashtami|navaratri|feast|fest|dasara|mela)\b/i.test(value)) return true;
  if (/^(?:relax|volunteering|encounter|join|roam|wander|jog|climb|ride|photo session|city watch)\b/i.test(value)) return true;
  if (/^(?:cycle|cycling|boating|fishing|campfire|massage|trekking|rappelling|hiking|picnic|rajayoga)(?:$|\s+(?:at|to|in|on|around|and|or)\b)/i.test(value)) return true;
  if (/^(?:bird\s*watching|paddy fields|rice fields|shopping|meditation|yoga|camping|diving|jet.ski|kitesurfing|paragliding|games|flower show|horse(?:\s*back)? riding|bungee jump(?:ing)?|reverse bungee jump(?:ing)?|rock climbing(?: and rappelling)?|cliff jumping|waterfall rappelling|pub hopping|get crowded|renovated streets and houses|dabba wallahs|chowpatty jayenge bhel puri khayenge|\d+(?:st|nd|rd|th) karmapa|waterfalls|bicycle|coir processing centres)$/i.test(value)) return true;
  if (/^(?:(?:Kodagu|Coorg)\s+)?white\s*water rafting$|^trekking, hiking & rock climbing$/i.test(value)) return true;
  if (/\b(?:performances|harbour cruise|heritage tour|elephant spotting|dance show|puppet show)\b|^yoga\s*@/i.test(value)) return true;
  if (/^(?:for example|remember|please note|note|important|warning|tip|sightseeing)$/i.test(value)) return true;
  return false;
}

export function withoutHiddenText(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(nowiki|pre|syntaxhighlight|source)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>|<ref\b[^>]*\/\s*>/gi, '');
}

// Balance templates and wikilinks rather than splitting a listing at every pipe.
function templatesIn(text) {
  const stack = [];
  const templates = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith('{{{', index)) {
      stack.push({ start: index, width: 3 });
      index += 2;
    } else if (text.startsWith('{{', index)) {
      stack.push({ start: index, width: 2 });
      index += 1;
    } else if (stack.length && text.startsWith('}'.repeat(stack.at(-1).width), index)) {
      const opening = stack.pop();
      const end = index + opening.width;
      if (opening.width === 2) templates.push({ start: opening.start, end, body: text.slice(opening.start + 2, index) });
      index = end - 1;
    }
  }
  return templates.sort((a, b) => a.start - b.start);
}

function splitFields(text) {
  const output = [];
  const braces = [];
  let links = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith('{{{', index)) { braces.push(3); index += 2; }
    else if (text.startsWith('{{', index)) { braces.push(2); index += 1; }
    else if (braces.length && text.startsWith('}'.repeat(braces.at(-1)), index)) { index += braces.pop() - 1; }
    else if (text.startsWith('[[', index)) { links += 1; index += 1; }
    else if (links && text.startsWith(']]', index)) { links -= 1; index += 1; }
    else if (text[index] === '|' && !braces.length && !links) { output.push(text.slice(start, index)); start = index + 1; }
  }
  output.push(text.slice(start));
  return output;
}

function templateFields(body) {
  const [rawType, ...parts] = splitFields(body);
  const fields = Object.create(null);
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals > -1) fields[part.slice(0, equals).trim().toLowerCase()] = part.slice(equals + 1).trim();
  }
  return { type: rawType.trim().replace(/^template\s*:/i, '').toLowerCase(), fields };
}

function plainText(value, limit = 700, depth = 0) {
  if (typeof value !== 'string' || depth > 8) return '';
  let text = withoutHiddenText(value);
  const templates = templatesIn(text);
  let output = '';
  let previousEnd = 0;
  for (const template of templates) {
    if (template.start < previousEnd) continue;
    const [name, ...fields] = splitFields(template.body);
    const positional = fields.filter(field => !/^\s*[\w -]+=/.test(field));
    const normalized = name.trim().toLowerCase();
    let replacement = '';
    if (['lang', 'langx'].includes(normalized)) replacement = positional.slice(1).join(' ');
    else if (['convert', 'cvt'].includes(normalized)) replacement = positional.slice(0, 2).join(' ');
    else if (['nowrap', 'small', 'smallcaps', 'formatnum', 'strong', 'em'].includes(normalized)) replacement = positional.join(' ');
    else if (normalized === '!') replacement = '|';
    // Unknown templates are omitted instead of leaking internal parameter names.
    output += text.slice(previousEnd, template.start) + plainText(replacement, limit, depth + 1);
    previousEnd = template.end;
  }
  text = output + text.slice(previousEnd);
  text = text.replace(/\[\[(?:file|image|category):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]]+)\]\]/g, (_, link) => link.split('|').at(-1).replace(/^[^#]*#/, ''))
    .replace(/\[(?:https?:)?\/\/[^\s\]]+(?:\s+([^\]]+))?\]/g, (_, label) => label || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/'{2,5}/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (match, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] || match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function categoryFor(name, heading = '') {
  const value = `${name} ${heading}`;
  if (/\b(?:beach|beaches|seashore)\b/i.test(value)) return 'Beaches';
  if (/\b(?:temples?|forts?|palaces?|museums?|monaster(?:y|ies)|church|mosque|heritage|memorial|cenotaphs?|basilica|ashram|satras?|sattras?)\b/i.test(value)) return 'Culture';
  if (/\b(?:trail|trek|hike|peak|hill|hills|mountain|pass)\b/i.test(value)) return 'Trails';
  if (/\b(?:lake|falls|waterfall|park|garden|forest|sanctuary|island|viewpoint|cave|caves|wetland|reservoir)\b/i.test(value)) return 'Nature';
  return 'Attractions';
}

function sectionsIn(text) {
  let root = null;
  const parents = [];
  return [...text.matchAll(/^(={2,6})[ \t]*(.*?)[ \t]*\1[ \t]*$/gm)].map(match => {
    const heading = plainText(match[2], 120);
    const level = match[1].length;
    if (level === 2) root = /^see\s+(?:and|&)\s+do$/i.test(heading) ? 'see' : heading.toLowerCase();
    while (parents.length && parents.at(-1).level >= level) parents.pop();
    parents.push({ level, heading });
    const excluded = parents.some(parent => /\b(?:festivals?|events?|fairs?|utsav|ganeshotsav)\b/i.test(parent.heading));
    return { start: match.index, root, heading, excluded };
  });
}

function sectionAt(sections, offset) {
  let result = { root: null, heading: '' };
  for (const section of sections) {
    if (section.start > offset) break;
    result = section;
  }
  return result;
}

function readCoordinates(fields, bbox) {
  const values = [fields.lat, fields.long ?? fields.lon ?? fields.lng];
  if (values.some(value => typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return { coordinates: null };
  const [lat, lng] = values.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { coordinates: null };
  const [south, west, north, east] = bbox;
  if (lat < south || lat > north || lng < west || lng > east) return { outside: true };
  return { coordinates: { lat, lng } };
}

export function validDestination(destination) {
  const box = destination?.bbox;
  return destination && ['id', 'city', 'state', 'wikivoyageTitle'].every(key => typeof destination[key] === 'string' && destination[key].trim()) &&
    Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) &&
    box[0] >= -90 && box[2] <= 90 && box[1] >= -180 && box[3] <= 180 && box[0] < box[2] && box[1] < box[3];
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function pageUrl(title, supplied) {
  try {
    const parsed = new URL(supplied);
    if (parsed.protocol === 'https:' && parsed.hostname === 'en.wikivoyage.org' && !parsed.username && !parsed.password && parsed.pathname.startsWith('/wiki/')) return parsed;
  } catch { /* Fall back to a title on the fixed public wiki host. */ }
  return new URL(`https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`);
}

export function parseWikivoyagePlaces(wikitext, destination, { title = destination?.wikivoyageTitle, url, updatedAt = null, fetchedAt = new Date().toISOString(), hashName = stableNameHash } = {}) {
  if (!validDestination(destination)) throw new TypeError('A destination with a valid bounded search region is required.');
  if (typeof wikitext !== 'string') throw new TypeError('Wikivoyage revision content must be text.');
  const text = withoutHiddenText(wikitext);
  const sections = sectionsIn(text);
  const candidates = [];
  const ranges = [];
  for (const template of templatesIn(text)) {
    const { type, fields } = templateFields(template.body);
    const section = sectionAt(sections, template.start);
    if (section.excluded) continue;
    if (EXCLUDED_TYPES.has(type) || EXCLUDED_TYPES.has(fields.type?.toLowerCase())) continue;
    if (!['see', 'do', 'listing', 'go', 'marker'].includes(type)) continue;
    if (section.root !== null && !['see', 'do'].includes(section.root)) continue;
    if (section.root === null && !['see', 'do'].includes(type)) continue;
    if (type === 'marker' && !['see', 'do'].includes(fields.type?.toLowerCase())) continue;
    const name = plainText(fields.name, 160);
    if (!name) continue;
    const category = categoryFor(name, section.heading);
    // Gokarna's beach listings use {{go}} inside Do; transport stops elsewhere do not qualify.
    if (type === 'go' && category === 'Attractions') continue;
    candidates.push({ fields, name, category, anchor: name, offset: template.start });
    ranges.push([template.start, template.end]);
  }
  // Some guides retain explicitly named, bold bullet listings rather than templates.
  for (const match of text.matchAll(/^(?:\*+[ \t]*)?(?:The[ \t]+)?'''([^\n]+?)'''([^\n]*)$/gm)) {
    const section = sectionAt(sections, match.index);
    if (section.excluded) continue;
    if (!['see', 'do'].includes(section.root) || ranges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    if (!match[0].startsWith('*') && section.root !== 'see') continue;
    if (match[0].includes('{{')) continue;
    const name = plainText(match[1], 160).replace(/[:;,]+$/, '').trim();
    if (name.length < 3 || name.length > 120 || /^(?:visit|swim|walk|watch|enjoy|take|try)\b/i.test(name)) continue;
    if (/\b(?:festivals?|utsav|ganeshotsav|fairs?)\b/i.test(`${name} ${section.heading}`)) continue;
    if (/^(?:bird\s*watching|paddy fields|rice fields|shopping|meditation|yoga|boating|trekking|climbing|sightseeing)$/i.test(name)) continue;
    if (name.includes(',')) continue; // A grouped village list is not one named place.
    candidates.push({ fields: { content: plainText(match[2].replace(/^[\s:–—-]+/, '')) }, name, category: categoryFor(name, section.heading), anchor: section.heading, offset: match.index });
  }
  // Regional articles such as Wayanad have simple named See lists. Keep their
  // source text as names; absent descriptions/coordinates remain absent.
  for (const match of text.matchAll(/^\*+[ \t]*([^\n]+)$/gm)) {
    const section = sectionAt(sections, match.index);
    if (section.excluded) continue;
    if (section.root !== 'see' || ranges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    if (match[1].includes('{{') || match[1].includes("'''")) continue;
    const parts = plainText(match[1], 2000).split(/\s+[–—]\s+/);
    const name = parts[0].replace(/[.;]+$/, '').trim();
    if (name.length < 3 || name.length > 100 || !/^[\p{Lu}\d]/u.test(name)) continue;
    if (/[!?;:]|\.\s|\b(?:is|are|has|have|can|will|should|visit|take|enjoy|hiking|walking|watching|located|situated)\b/i.test(name)) continue;
    if (/\b(?:festivals?|events?|fairs?|activities)\b/i.test(`${name} ${section.heading}`)) continue;
    if ((match[1].match(/\[\[/g) || []).length > 1 && /\band\b/i.test(name)) continue;
    candidates.push({ fields: { content: parts.slice(1).join(' — ') }, name, category: categoryFor(name, section.heading), anchor: section.heading, offset: match.index });
  }
  const result = new Map();
  const baseUrl = pageUrl(title, url);
  for (const candidate of candidates.sort((a, b) => a.offset - b.offset)) {
    const { fields, name, category, anchor } = candidate;
    if (isNonPlaceName(name)) continue;
    const rawDescription = fields.content || fields.description || fields.directions || '';
    const description = plainText(rawDescription).replace(/^#\d+\.?\s*/, '');
    if (/^(?:an?|the) (?:annual|yearly) (?:exhibition|festival|event|fair)\b|\bthis is the event to attend\b/i.test(description)) continue;
    if (/\band\b/i.test(name) && /\bthe latter\b.*\bthe former\b/i.test(description)) continue;
    if (/^(?:no|private|restricted)$/i.test(fields.access?.trim() || '') || PRIVATE_ACCESS.test(`${plainText(rawDescription, MAX_RESPONSE_BYTES)} ${plainText(fields.directions)}`)) continue;
    if (/\b(?:festivals?|utsav|ganeshotsav|fairs?)\b/i.test(name)) continue;
    const location = readCoordinates(fields, destination.bbox);
    if (location.outside) continue;
    const key = name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!key) continue;
    if (result.has(key)) {
      const previous = result.get(key);
      if (!previous.coordinates && location.coordinates) previous.coordinates = location.coordinates;
      continue;
    }
    const sourceUrl = new URL(baseUrl);
    sourceUrl.hash = anchor.replace(/ /g, '_');
    result.set(key, {
      id: `wv-${destination.id}-${hashName(key)}`,
      name, city: destination.city, destinationId: destination.id, state: destination.state, country: 'India', category,
      coordinates: location.coordinates || null, description, tags: [], image: null,
      updatedAt: validTimestamp(updatedAt),
      sources: [{
        url: sourceUrl.href, title: `${title} — ${name}`, kind: 'guide', publisher: 'Wikivoyage',
        retrievedAt: fetchedAt, publishedAt: null, updatedAt: validTimestamp(updatedAt),
        listingUpdatedAt: validTimestamp(fields.lastedit), excerpt: description, license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      }],
    });
    if (result.size >= MAX_PLACES) break;
  }
  return [...result.values()];
}
