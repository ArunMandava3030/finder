const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FEATURE_FILTERS = [
  '["tourism"~"^(attraction|viewpoint|museum)$"]',
  '["natural"~"^(beach|cave_entrance|peak)$"]',
  '["waterway"="waterfall"]',
  '["historic"~"^(castle|fort|ruins|archaeological_site|monument)$"]',
  '["leisure"~"^(nature_reserve|park|garden)$"]',
];

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function abortError() {
  return new DOMException('Place collection cancelled.', 'AbortError');
}

function clean(value, limit = 600) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

function validateDestination(destination) {
  const bbox = destination?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw failure('OSM_INVALID_DESTINATION', 'Provide a destination with a numeric [south, west, north, east] bounding box.');
  }
  const [south, west, north, east] = bbox;
  if (south < 6 || north > 38 || west < 68 || east > 98 || south >= north || west >= east || north - south > 2 || east - west > 2) {
    throw failure('OSM_INVALID_DESTINATION', 'Use a bounded India destination area no larger than two degrees in each direction.');
  }
  const id = clean(destination.id, 100);
  const city = clean(destination.name || destination.city, 120);
  const state = clean(destination.state, 120);
  if (!id || !city || !state) throw failure('OSM_INVALID_DESTINATION', 'Provide the destination id, name or city, and state.');
  return { id, city, state, bbox };
}

function classify(tags) {
  if (tags.natural === 'beach') return { category: 'Beaches', feature: 'Beach' };
  if (tags.natural === 'cave_entrance') return { category: 'Trails', feature: 'Cave entrance' };
  if (tags.natural === 'peak') return { category: 'Trails', feature: 'Peak' };
  if (tags.waterway === 'waterfall') return { category: 'Nature', feature: 'Waterfall' };
  if (tags.tourism === 'museum') return { category: 'Culture', feature: 'Museum' };
  if (['castle', 'fort', 'ruins', 'archaeological_site', 'monument'].includes(tags.historic)) {
    return { category: 'Culture', feature: tags.historic.replace(/_/g, ' ') };
  }
  if (['nature_reserve', 'park', 'garden'].includes(tags.leisure)) {
    return { category: 'Nature', feature: tags.leisure.replace(/_/g, ' ') };
  }
  if (tags.tourism === 'viewpoint') return { category: 'Nature', feature: 'Viewpoint' };
  if (tags.tourism === 'attraction') return { category: 'Attractions', feature: 'Attraction' };
  return null;
}

function unavailablePlace(tags) {
  if (['access', 'foot'].some((key) => /(?:^|[;,])\s*(?:private|no)\s*(?:$|[;,])/i.test(tags[key] || ''))) return true;
  if (Object.entries(tags).some(([key, value]) => /^(?:abandoned|disused|demolished|removed|razed)(?::|$)/i.test(key)
    && !['no', 'false', '0', ''].includes(String(value).toLowerCase()))) return true;
  const country = String(tags['addr:country'] || '').trim().toLowerCase();
  return country && !['in', 'india'].includes(country);
}

function isoDate(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function toPlace(element, destination, fetchedAt) {
  if (!element || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) return null;
  const tags = element.tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags) || unavailablePlace(tags)) return null;
  const name = clean(tags['name:en'] || tags.name, 180);
  const type = classify(tags);
  if (!name || !type) return null;
  const lat = element.type === 'node' ? element.lat : element.center?.lat;
  const lng = element.type === 'node' ? element.lon : element.center?.lon;
  const [south, west, north, east] = destination.bbox;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < south || lat > north || lng < west || lng > east) return null;
  const mappedDescription = clean(tags['description:en'] || tags.description, 700);
  const description = mappedDescription || `${type.feature.charAt(0).toUpperCase()}${type.feature.slice(1)} mapped near ${destination.city}, ${destination.state}.`;
  const featureTags = ['tourism', 'natural', 'waterway', 'historic', 'leisure']
    .filter((key) => typeof tags[key] === 'string')
    .map((key) => `${key}=${clean(tags[key], 80)}`);
  return {
    id: `osm:${element.type}:${element.id}`,
    name,
    city: destination.city,
    destinationId: destination.id,
    state: destination.state,
    country: 'India',
    category: type.category,
    coordinates: { lat, lng },
    description,
    tags: [...new Set(featureTags.map((tag) => tag.split('=')[1].replace(/_/g, ' ')))],
    sources: [{
      url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      title: `${name} on OpenStreetMap`,
      kind: 'map',
      publisher: 'OpenStreetMap',
      retrievedAt: fetchedAt,
      publishedAt: null,
      updatedAt: isoDate(element.timestamp),
      excerpt: mappedDescription || `Mapped feature: ${featureTags.join(', ')}.`,
      license: 'ODbL',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      attribution: '© OpenStreetMap contributors',
    }],
    image: null,
  };
}

async function readJson(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new Error('Response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  let content = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/** Fetch one bounded destination snapshot. Callers own caching and refresh scheduling. */
export async function fetchOsmPlaces(destination, {
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 25_000,
  endpoint = process.env.OVERPASS_URL || DEFAULT_ENDPOINT,
  maxPlaces = 100,
  now = Date.now,
  userAgent = process.env.OVERPASS_USER_AGENT || 'ElsewhereDiscovery/1.0 (India place catalog)',
} = {}) {
  const city = validateDestination(destination);
  if (signal?.aborted) throw abortError();
  let url;
  try {
    url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid endpoint');
  } catch {
    throw failure('OSM_CONFIGURATION_ERROR', 'Configure a valid HTTP or HTTPS Overpass endpoint.');
  }
  const cap = Math.min(200, Math.max(1, Math.floor(Number(maxPlaces) || 100)));
  const upstreamCap = cap * 3 + 1;
  const deadline = Math.min(60_000, Math.max(1, Number(timeoutMs) || 25_000));
  const queryTimeout = Math.max(1, Math.min(30, Math.floor(deadline / 1000) - 2));
  const filter = '[~"^name(:en)?$"~"."]["access"!~"^(private|no)$"]["foot"!~"^(private|no)$"]["abandoned"!="yes"]["disused"!="yes"]';
  const query = `[out:json][timeout:${queryTimeout}][maxsize:33554432];\n(\n${FEATURE_FILTERS.map((feature) => `nwr${feature}${filter}(${city.bbox.join(',')});`).join('\n')}\n);\nout meta center ${upstreamCap};`;
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(failure('OSM_TIMEOUT', 'The OpenStreetMap query timed out. Try this destination again later.'));
    }, deadline);
  });
  const request = (async () => {
    const response = await fetchImpl(url.href, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': clean(userAgent, 240) },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (response.status === 429) {
      const retryAfterSeconds = Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 60));
      throw failure('OSM_RATE_LIMITED', 'OpenStreetMap is rate limiting requests. Retry after a pause.', { retryAfterSeconds });
    }
    if (!response.ok) throw failure('OSM_UNAVAILABLE', 'The OpenStreetMap provider is unavailable. Try again later.');
    const data = await readJson(response);
    if (!Array.isArray(data?.elements) || data.remark) {
      throw failure('OSM_UNAVAILABLE', 'OpenStreetMap did not return a complete place snapshot. The previous snapshot should be retained.');
    }
    return data;
  })();
  try {
    const data = await Promise.race([request, interrupted]);
    if (signal?.aborted) throw abortError();
    const fetchedAt = new Date(now()).toISOString();
    const seen = new Set();
    const candidates = data.elements.slice(0, upstreamCap).map((element) => toPlace(element, city, fetchedAt))
      .filter((place) => place && !seen.has(place.id) && seen.add(place.id));
    const warnings = ['OpenStreetMap provides mapped places, not visitor reviews or a verified ranking of hidden places. Check current access at the original source.'];
    if (data.elements.length >= upstreamCap || candidates.length > cap) warnings.push(`This destination snapshot is limited to ${cap} places; it is not a complete inventory.`);
    return { places: candidates.slice(0, cap), warnings, provider: 'osm', fetchedAt };
  } catch (error) {
    controller.abort();
    if (signal?.aborted) throw abortError();
    if (typeof error.code === 'string' && error.code.startsWith('OSM_')) throw error;
    throw failure('OSM_UNAVAILABLE', 'The OpenStreetMap provider could not complete this request.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
