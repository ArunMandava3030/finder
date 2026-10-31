"""Collect factual place listings from explicitly configured public tourism pages.

Scrapling handles HTML extraction. A bounded HTTP transport handles fetching, so
the scheduled collector needs neither browser binaries nor paid services.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from scrapling.parser import Selector

USER_AGENT = 'ElsewhereBot/1.0 (+https://github.com/ArunMandava3030/finder)'
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 256 * 1024
MAX_SOURCES = 200
MAX_PLACES = 60
TIMEOUT_SECONDS = 12
PRIVATE_ACCESS = re.compile(r'\b(?:private property|no public access|closed permanently|permanently closed|not open to (?:the )?public)\b', re.I)
CROWD_SIGNAL = re.compile(r'\b(?:uncrowded|unfrequented|(?:less|least|lightly|sparsely|rarely|seldom)[ -](?:crowded|visited|frequented)|(?:few|fewer|hardly any|not many)\s+(?:people|visitors|tourists|travellers|travelers)|(?:little|low|minimal|limited)\s+(?:crowding|crowds?|footfall|visitor numbers)|(?:without|away from|far from)\s+(?:the\s+)?crowds?|not\s+(?:very\s+)?crowded|crowd[ -]free|crowded|overcrowded)\b', re.I)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def public_url(value: object, base: str | None = None) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 2048 or re.search(r'[\x00-\x20\x7f\\]', value):
        return None
    try:
        parsed = urlsplit(urljoin(base, value) if base else value)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
        host = parsed.hostname.lower()
        if '.' not in host or host.endswith(('.local', '.localhost', '.internal')):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        return urlunsplit(('https', parsed.netloc.lower(), parsed.path or '/', parsed.query, parsed.fragment))
    except (ValueError, TypeError):
        return None


def origin(url: str) -> str:
    parsed = urlsplit(url)
    return f'{parsed.scheme}://{parsed.netloc}'


@dataclass
class Document:
    status: int
    body: bytes
    content_type: str = ''
    url: str = ''


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def fetch_document(url: str, maximum: int = MAX_HTML_BYTES) -> Document:
    if not public_url(url):
        raise ValueError('Invalid public source URL.')
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity'})
    opener = build_opener(NoRedirects())
    try:
        response = opener.open(request, timeout=TIMEOUT_SECONDS)
    except HTTPError as error:
        response = error
    with response:
        status = response.status
        if status not in (200, 204):
            return Document(status, b'', response.headers.get('Content-Type', ''), url)
        advertised = response.headers.get('Content-Length', '')
        if advertised.isdigit() and int(advertised) > maximum:
            raise ValueError('Source response exceeds the size limit.')
        if response.headers.get('Content-Encoding', 'identity').lower() not in ('identity', ''):
            raise ValueError('Unexpected compressed response.')
        chunks = []
        count = 0
        started = time.monotonic()
        while True:
            if time.monotonic() - started > TIMEOUT_SECONDS:
                raise TimeoutError('Source response deadline exceeded.')
            # One underlying read returns promptly on trickling responses; read()
            # could wait indefinitely to fill the buffer despite an idle timeout.
            chunk = response.read1(min(65536, maximum + 1 - count))
            if not chunk:
                break
            count += len(chunk)
            if count > maximum:
                raise ValueError('Source response exceeds the size limit.')
            chunks.append(chunk)
        return Document(status, b''.join(chunks), response.headers.get('Content-Type', ''), url)


def robots_policy(body: bytes, url: str) -> tuple[bool, float]:
    """Match robots groups, wildcard paths, end anchors and Allow tie precedence."""
    text = body.decode('utf-8-sig', errors='replace')
    if re.search(r'<(?:!doctype|html|head|body)\b', text, re.I):
        raise ValueError('robots.txt returned HTML instead of crawler rules.')
    groups = []
    agents, rules, delay = [], [], 1.5
    directives_seen = False
    for raw in [*text.splitlines(), 'user-agent: __end__']:
        line = raw.split('#', 1)[0].strip()
        if ':' not in line:
            continue
        key, value = (part.strip() for part in line.split(':', 1))
        key = key.lower()
        if key == 'user-agent':
            if directives_seen:
                groups.append((agents, rules, delay))
                agents, rules, delay, directives_seen = [], [], 1.5, False
            agents.append(value.lower())
        elif agents and key in ('allow', 'disallow', 'crawl-delay'):
            directives_seen = True
            if key == 'crawl-delay':
                try:
                    parsed = float(value)
                    if math.isfinite(parsed) and parsed >= 0:
                        delay = max(1.5, parsed)
                except ValueError:
                    pass
            elif value:
                rules.append((key == 'allow', unquote(value)))
    candidates = []
    for agents, rules, delay in groups:
        specificity = max((0 if agent == '*' else len(agent) for agent in agents if agent == '*' or agent in 'elsewherebot'), default=-1)
        if specificity >= 0:
            candidates.append((specificity, rules, delay))
    if not candidates:
        return True, 1.5
    specificity = max(group[0] for group in candidates)
    chosen = [group for group in candidates if group[0] == specificity]
    path = urlsplit(url).path + (f'?{urlsplit(url).query}' if urlsplit(url).query else '')
    path = unquote(path)
    matches = []
    for _, rules, _ in chosen:
        for allow, pattern in rules:
            expression = re.escape(pattern).replace(r'\*', '.*')
            if pattern.endswith('$'):
                expression = expression[:-2] + '$'
            if re.match(expression, path):
                matches.append((len(pattern.replace('*', '').rstrip('$')), allow))
    return (max(matches)[1] if matches else True), max(group[2] for group in chosen)


def node_text(node) -> str:
    value = str(node) if isinstance(node, str) else node.get_all_text(separator=' ', strip=True)
    return re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', ' ', value)).strip()


def selected_text(node, selector: str | None) -> str:
    selected = node.css(selector) if selector else [node]
    return node_text(selected[0]) if selected else ''


def normalized_name(value: str) -> str:
    return re.sub(r'[^\w]+', ' ', value.casefold()).strip()


def normalized_evidence(value: str) -> str:
    return re.sub(r'\s+', ' ', value.replace('\u2019', "'").replace('\u2018', "'").replace('\u00a0', ' ')).strip().casefold()


def category_for(name: str) -> str:
    if re.search(r'\b(?:beach|beaches)\b', name, re.I):
        return 'Beaches'
    if re.search(r'\b(?:temple|fort|palace|museum|church|mosque|monastery|heritage|memorial|basilica)\b', name, re.I):
        return 'Culture'
    if re.search(r'\b(?:trail|trek|peak|hill|hills|mountain)\b', name, re.I):
        return 'Trails'
    if re.search(r'\b(?:lake|falls|waterfall|park|garden|forest|sanctuary|island|viewpoint|cave|caves|reservoir|rock)\b', name, re.I):
        return 'Nature'
    return 'Attractions'


def jsonld_coordinates(page, name: str, bbox: list) -> dict | None:
    candidates = []
    for script in page.css('script[type="application/ld+json"]')[:10]:
        try:
            data = json.loads(script.css('::text').get(default=''))
        except (ValueError, TypeError):
            continue
        candidates.extend(data if isinstance(data, list) else [data])
    for obj in candidates[:50]:
        if isinstance(obj, dict) and isinstance(obj.get('@graph'), list):
            candidates.extend(obj['@graph'][:50])
    for obj in candidates[:100]:
        if not isinstance(obj, dict) or normalized_name(str(obj.get('name', ''))) != normalized_name(name):
            continue
        geo = obj.get('geo')
        types = obj.get('@type', [])
        types = types if isinstance(types, list) else [types]
        if types and not any(kind in {'TouristAttraction', 'Place', 'LandmarksOrHistoricalBuildings', 'Beach', 'Park', 'Museum', 'Mountain', 'Waterfall', 'LakeBodyOfWater'} for kind in types):
            continue
        if not isinstance(geo, dict):
            continue
        try:
            lat, lng = float(geo['latitude']), float(geo['longitude'])
        except (KeyError, TypeError, ValueError):
            continue
        if all(math.isfinite(n) for n in (lat, lng)) and bbox[0] <= lat <= bbox[2] and bbox[1] <= lng <= bbox[3]:
            return {'lat': lat, 'lng': lng}
        if all(math.isfinite(n) for n in (lat, lng)):
            raise ValueError('The source places this attraction outside the destination area.')
    return None


def article_published_period(page) -> str | None:
    """Read a month beside the article heading, never site-wide footer dates."""
    periods = set()
    months = {month.casefold(): index for index, month in enumerate((
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ), 1)}
    for node in page.xpath('//h1/preceding-sibling::*[1]')[:5]:
        match = re.fullmatch(r'([A-Za-z]+)\s+(\d{4})', node_text(node))
        if not match or match[1].casefold() not in months:
            continue
        year, month = int(match[2]), months[match[1].casefold()]
        current = datetime.now(timezone.utc)
        if 1900 <= year and (year, month) <= (current.year, current.month):
            periods.add(f'{year:04d}-{month:02d}')
    return next(iter(periods)) if len(periods) == 1 else None


def crowd_place_name(value: str) -> str:
    name = re.sub(r'\s+', ' ', value).strip()
    if name in {'Gokarna Om Beach', 'Gokarna Kudle Beach'}:
        name = name.removeprefix('Gokarna ')
    if name == 'Main Beach':
        name = 'Gokarna Main Beach'
    return name.replace('Half-Moon Beach', 'Half Moon Beach')


def extract_crowd_table(page, source: dict, destination: dict, fetched_at: str) -> list[dict]:
    levels = {'High': ('high', 'busy'), 'Moderate': ('moderate', 'mixed'), 'Low': ('low', 'quieter'), 'Very Low': ('very_low', 'quieter')}
    matches = []
    for table in page.css('table')[:30]:
        rows = table.css('tr')
        if len(rows) > 300:
            raise ValueError('Too many comparison rows; review the source table.')
        for position, row in enumerate(rows):
            cells = row.xpath('./th|./td')
            headers = [node_text(cell) for cell in cells]
            if headers.count('Beach') == 1 and headers.count('Crowd Level') == 1:
                if len(headers) > 20 or any(cell.attrib.get('colspan', '1') != '1' or cell.attrib.get('rowspan', '1') != '1' for cell in cells):
                    continue
                matches.append((rows[position + 1:], headers))
                break
    # Ambiguous competing tables cannot establish a single comparison safely.
    if len(matches) != 1:
        return []
    rows, headers = matches[0]
    published_period = article_published_period(page)
    details = {normalized_name(name): fields for name, fields in source.get('placeDetails', {}).items()}
    places, seen = [], set()
    for row in rows:
        cells = row.xpath('./th|./td')
        if len(cells) != len(headers) or any(cell.attrib.get('colspan', '1') != '1' or cell.attrib.get('rowspan', '1') != '1' for cell in cells):
            continue
        fields = dict(zip(headers, (node_text(cell) for cell in cells)))
        label = fields['Crowd Level']
        # Never borrow a value from Facilities/Access when the crowd cell is blank.
        if label not in levels:
            continue
        name = crowd_place_name(fields['Beach'])
        if not 3 <= len(name) <= 160 or len(name.split()) > 20 or re.search(r'https?://|@|[<>]', name) or PRIVATE_ACCESS.search(node_text(row)):
            continue
        key = normalized_name(name)
        if key in seen:
            continue
        seen.add(key)
        level, direction = levels[label]
        url = source['url']
        evidence = {
            'url': url, 'publisher': source['publisher'],
            'claim': f'The tourism guide classifies {name} crowd levels as {label.lower()}.',
            'direction': direction, 'level': level, 'sourceUpdatedAt': None,
            'publishedPeriod': published_period, 'retrievedAt': fetched_at,
            'conditional': False, 'context': 'General guide comparison; not a live headcount.',
            'sourceType': 'official', 'provider': 'scrapling', 'sourceId': source['id'],
        }
        place = {
            'id': f"scrapling:{source['id']}:{hashlib.sha256((url + '|' + key).encode()).hexdigest()[:16]}",
            'name': name, 'city': destination['city'], 'state': destination['state'],
            'destinationId': destination['id'], 'country': 'India', 'category': 'Beaches',
            'coordinates': None, 'image': None, 'tags': ['official tourism'],
            'description': f"Listed by {source['publisher']}. Open the original source for place details and current visitor information.",
            'crowdEvidence': [evidence],
            'sources': [{
                'url': url, 'title': name, 'kind': 'guide', 'publisher': source['publisher'],
                'provider': 'scrapling', 'sourceId': source['id'], 'catalogUrl': url,
                'collectionMethod': 'scrapling', 'retrievedAt': fetched_at,
                'publishedAt': None, 'updatedAt': None, 'excerpt': '',
                'license': 'Factual metadata; see source terms',
            }],
        }
        place.update(details.get(key, {}))
        places.append(place)
    if len(places) > source.get('maxPlaces', MAX_PLACES):
        raise ValueError('Comparison exceeds the configured place limit.')
    return places


def extract_places(body: bytes, source: dict, destination: dict, fetched_at: str) -> list[dict]:
    page = Selector(body, url=source['url'], encoding='utf-8', huge_tree=False, adaptive=False)
    if source['parser'] == 'crowd_table':
        return extract_crowd_table(page, source, destination, fetched_at)
    if source['parser'] == 'crowd_claim':
        return extract_crowd_claims(page, source, destination, fetched_at)
    nodes = page.css(source.get('itemSelector') or ('h1' if source['parser'] == 'detail' else 'main h2 a'))
    if len(nodes) > 300:
        raise ValueError('Too many candidate elements; review the source selectors.')
    allowed_names = {normalized_name(name) for name in source.get('allowedNames', [])}
    places, seen = [], set()
    for node in nodes:
        name = selected_text(node, source.get('nameSelector'))
        if not 3 <= len(name) <= 160 or len(name.split()) > 20 or re.search(r'https?://|@|[<>]', name):
            continue
        if re.search(r'\b(?:page not found|404|access denied|just a moment|captcha)\b', name, re.I):
            continue
        if PRIVATE_ACCESS.search(node_text(node)) or normalized_name(name) in {'read more', 'learn more', 'know more', 'places to visit', 'tourist places', 'view all', 'contact us'}:
            continue
        if allowed_names and normalized_name(name) not in allowed_names:
            continue
        link_nodes = node.css(source['linkSelector']) if source.get('linkSelector') else []
        if source.get('linkSelector') and not link_nodes:
            continue
        link = link_nodes[0] if link_nodes else node
        # Scrapling wraps CSS attribute results in Selector objects as well.
        href = link.get() if (source.get('linkSelector') or '').endswith('::attr(href)') else str(link) if isinstance(link, str) else link.attrib.get('href', '')
        url = public_url(href, source['url']) if href else source['url']
        allowed_origins = {origin(source['url']), *source.get('allowedOrigins', [])}
        if not url or origin(url) not in allowed_origins:
            continue
        if source.get('linkPattern') and not re.search(source['linkPattern'], urlsplit(url).path):
            continue
        if source.get('allowedPaths') and urlsplit(url).path not in source['allowedPaths']:
            continue
        key = normalized_name(name)
        if key in seen:
            continue
        seen.add(key)
        category = source.get('category') or category_for(name)
        try:
            coordinates = jsonld_coordinates(page, name, destination['bbox']) if source['parser'] == 'detail' else None
        except ValueError:
            continue
        description = f"Listed by {source['publisher']}. Open the original source for place details and current visitor information."
        places.append({
            'id': f"scrapling:{source['id']}:{hashlib.sha256((url + '|' + key).encode()).hexdigest()[:16]}",
            'name': name, 'city': destination['city'], 'state': destination['state'],
            'destinationId': destination['id'], 'country': 'India', 'category': category,
            'coordinates': coordinates,
            'description': description, 'tags': ['official tourism'], 'image': None,
            'sources': [{
                'url': url, 'title': name, 'kind': 'guide', 'publisher': source['publisher'],
                'provider': 'scrapling', 'sourceId': source['id'], 'catalogUrl': source['url'],
                'collectionMethod': 'scrapling', 'retrievedAt': fetched_at,
                'publishedAt': None, 'updatedAt': None, 'excerpt': '',
                'license': 'Factual metadata; see source terms',
            }],
        })
    if len(places) > source.get('maxPlaces', MAX_PLACES):
        raise ValueError('Place count exceeds the configured limit; review coverage before publishing.')
    return places


def extract_crowd_claims(page, source: dict, destination: dict, fetched_at: str) -> list[dict]:
    """Recheck complete reviewed passages; publish only bounded factual paraphrases.

    Exact paragraph matching deliberately stops on editorial changes, including
    added caveats. A scenic/peaceful/hidden label alone is never crowd evidence.
    """
    places = []
    details = {normalized_name(name): fields for name, fields in source.get('placeDetails', {}).items()}
    for claim in source['claims']:
        nodes = page.css(claim['selector'])
        if len(nodes) > 100:
            raise ValueError('The reviewed crowd selector is no longer narrow enough.')
        matches = [node_text(node) for node in nodes if hashlib.sha256(normalized_evidence(node_text(node)).encode()).hexdigest() == claim['evidenceSha256']]
        if len(matches) != 1 or PRIVATE_ACCESS.search(matches[0]) or not CROWD_SIGNAL.search(matches[0]):
            continue
        name, url = claim['name'], source['url']
        evidence = {
            'url': url, 'publisher': source['publisher'], 'claim': claim['claim'],
            'claimId': claim['id'], 'direction': claim['direction'],
            'sourceUpdatedAt': None, 'publishedPeriod': None, 'retrievedAt': fetched_at,
            'conditional': claim['conditional'], 'context': claim['context'],
            'sourceType': 'official', 'provider': 'scrapling', 'sourceId': source['id'],
        }
        place = {
            'id': f"scrapling:{source['id']}:{hashlib.sha256((url + '|' + normalized_name(name)).encode()).hexdigest()[:16]}",
            'name': name, 'city': destination['city'], 'state': destination['state'],
            'destinationId': destination['id'], 'country': 'India',
            'category': source.get('category') or category_for(name),
            'coordinates': None, 'image': None, 'tags': ['official tourism'],
            'description': f"Listed by {source['publisher']}. Open the original source for place details and current visitor information.",
            'crowdEvidence': [evidence],
            'sources': [{
                'url': url, 'title': name, 'kind': 'guide', 'publisher': source['publisher'],
                'provider': 'scrapling', 'sourceId': source['id'], 'catalogUrl': url,
                'collectionMethod': 'scrapling', 'retrievedAt': fetched_at,
                'publishedAt': None, 'updatedAt': None, 'excerpt': '',
                'license': 'Factual metadata; see source terms',
            }],
        }
        place.update(details.get(normalized_name(name), {}))
        places.append(place)
    return places


def validate_sources(manifest: dict, destinations: list) -> list[dict]:
    sources = manifest.get('sources') if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES:
        raise ValueError('Invalid source manifest.')
    ids, destination_ids = set(), {destination['id'] for destination in destinations}
    for source in sources:
        if not isinstance(source, dict) or not re.fullmatch(r'[a-z0-9-]{1,80}', source.get('id', '')) or source['id'] in ids:
            raise ValueError('Sources need unique, bounded identifiers.')
        ids.add(source['id'])
        if source.get('destinationId') not in destination_ids or source.get('parser') not in {'listing', 'detail', 'crowd_table', 'crowd_claim'} or not public_url(source.get('url')):
            raise ValueError('Invalid source destination, URL or parser.')
        if not isinstance(source.get('publisher'), str) or not 2 <= len(source['publisher']) <= 160:
            raise ValueError('Sources need an attributed publisher.')
        if not isinstance(source.get('maxPlaces', MAX_PLACES), int) or not 1 <= source.get('maxPlaces', MAX_PLACES) <= MAX_PLACES:
            raise ValueError('Invalid place limit.')
        if source['parser'] == 'listing' and source.get('scope') != 'destination' and not source.get('allowedNames') and not source.get('allowedPaths'):
            raise ValueError('A regional listing needs an explicit destination scope or geographic allowlist.')
        for allowed in source.get('allowedOrigins', []):
            if not public_url(allowed) or origin(allowed) != allowed:
                raise ValueError('Invalid source origin.')
        for field in ('itemSelector', 'nameSelector', 'linkSelector', 'linkPattern'):
            if field in source and (not isinstance(source[field], str) or len(source[field]) > 500):
                raise ValueError('Invalid extraction selector.')
        if source['parser'] == 'crowd_claim':
            claims = source.get('claims')
            if not isinstance(claims, list) or not 1 <= len(claims) <= min(20, source.get('maxPlaces', MAX_PLACES)):
                raise ValueError('A crowd source needs bounded reviewed claims.')
            claim_ids, claim_names = set(), set()
            for claim in claims:
                if not isinstance(claim, dict) or not re.fullmatch(r'[a-z0-9-]{1,80}', claim.get('id', '')) or claim['id'] in claim_ids:
                    raise ValueError('Invalid reviewed claim identifier.')
                for field, maximum in [('name', 160), ('selector', 500), ('claim', 360), ('context', 300)]:
                    if not isinstance(claim.get(field), str) or not 3 <= len(claim[field].strip()) <= maximum:
                        raise ValueError('Invalid reviewed crowd claim.')
                if normalized_name(claim['name']) in claim_names or claim.get('direction') not in {'quieter', 'busy'} or not isinstance(claim.get('conditional'), bool):
                    raise ValueError('Ambiguous reviewed crowd claim.')
                if not re.fullmatch(r'[a-f0-9]{64}', claim.get('evidenceSha256', '')) or not CROWD_SIGNAL.search(claim['claim']):
                    raise ValueError('A crowd claim needs an explicit visitor or crowd statement.')
                claim_ids.add(claim['id'])
                claim_names.add(normalized_name(claim['name']))
        details = source.get('placeDetails', {})
        if not isinstance(details, dict) or len(details) > MAX_PLACES:
            raise ValueError('Invalid place details mapping.')
        for name, fields in details.items():
            if not isinstance(name, str) or not 3 <= len(name) <= 160 or not isinstance(fields, dict) or not set(fields).issubset({'area', 'accessNotes'}):
                raise ValueError('Only verified place area and access notes may be configured.')
            if any(not isinstance(value, str) or not 1 <= len(value) <= 500 for value in fields.values()):
                raise ValueError('Invalid place detail text.')
    return sources


def collect(manifest: dict, destinations: list, *, fetch=fetch_document, pause=time.sleep, only: set | None = None, deadline_seconds: float | None = None) -> dict:
    sources = validate_sources(manifest, destinations)
    if only is not None and not only.issubset({source['id'] for source in sources}):
        raise ValueError('Unknown source in --only.')
    destinations_by_id = {destination['id']: destination for destination in destinations}
    robots_cache, next_request = {}, {}
    results = []
    deadline = time.monotonic() + deadline_seconds if deadline_seconds is not None else None
    for source in sources:
        if only is not None and source['id'] not in only:
            continue
        if source.get('enabled') is False:
            continue
        if deadline is not None and time.monotonic() >= deadline:
            print('Collection time budget reached; unattempted sources retain earlier data.', file=sys.stderr)
            break
        result = {key: source[key] for key in ('id', 'destinationId', 'url', 'publisher')}
        result.update({'status': 'unavailable', 'fetchedAt': None, 'attemptedAt': timestamp(), 'places': [], 'warnings': []})
        host = origin(source['url'])
        try:
            if host not in robots_cache:
                try:
                    robots_cache[host] = fetch(host + '/robots.txt', MAX_ROBOTS_BYTES)
                except Exception:
                    robots_cache[host] = None
                next_request[host] = time.monotonic() + 1.5
            robots = robots_cache[host]
            if robots is None or robots.status not in (200, 204, 404):
                result['warnings'].append('Crawler rules could not be checked; this source was not collected.')
            else:
                allowed, delay = robots_policy(robots.body, source['url']) if robots.status == 200 else (True, 1.5)
                if not allowed or delay > 30:
                    result['status'] = 'blocked'
                    result['warnings'].append('The source crawler rules prevent collection within this batch.')
                else:
                    pause(max(0, next_request.get(host, time.monotonic()) - time.monotonic(), delay))
                    response = fetch(source['url'], MAX_HTML_BYTES)
                    next_request[host] = time.monotonic() + delay
                    if response.status in (401, 403, 429):
                        result['status'] = 'blocked'
                        result['warnings'].append('The source denied or limited this request; it was not retried.')
                    elif response.status != 200:
                        result['warnings'].append('The source page was unavailable or redirected; earlier records may be retained.')
                    elif 'html' not in response.content_type.lower() and response.content_type:
                        result['warnings'].append('The source did not return an HTML page.')
                    elif re.search(rb'<title[^>]*>\s*(?:just a moment|access denied|verify you are human|attention required)', response.body[:100000], re.I):
                        result['status'] = 'blocked'
                        result['warnings'].append('The source returned a verification page; no places were extracted.')
                    else:
                        fetched_at = timestamp()
                        places = extract_places(response.body, source, destinations_by_id[source['destinationId']], fetched_at)
                        result.update({'status': 'ok' if places else 'empty', 'fetchedAt': fetched_at, 'places': places})
                        if not places:
                            result['warnings'].append('No matching place listings were extracted. The page layout may have changed.')
        except Exception:
            result['warnings'].append('Collection or extraction could not complete. No replacement records were emitted.')
        results.append(result)
        print(f"{source['id']}: {result['status']} ({len(result['places'])} places)", file=sys.stderr)
    return {'schemaVersion': 1, 'provider': 'scrapling', 'generatedAt': timestamp(), 'sources': results}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=Path('data/scrapling-sources.json'))
    parser.add_argument('--destinations', type=Path, default=Path('data/india-destinations.json'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--only', help='Comma-separated registered source IDs; no arbitrary URLs.')
    parser.add_argument('--batch', type=Path, help='Refresh plan containing registered sourceIds.')
    parser.add_argument('--budget-seconds', type=int, default=200, help='Stop between sources and write a partial batch before the workflow deadline.')
    args = parser.parse_args()
    try:
        if args.sources.stat().st_size > 256 * 1024 or args.destinations.stat().st_size > 256 * 1024:
            raise ValueError('Configuration is too large.')
        manifest = json.loads(args.sources.read_text(encoding='utf-8-sig'))
        destinations = json.loads(args.destinations.read_text(encoding='utf-8-sig'))
        only = set(args.only.split(',')) if args.only else None
        if args.batch:
            if args.only or args.batch.stat().st_size > 256 * 1024:
                raise ValueError('Invalid refresh plan.')
            batch = json.loads(args.batch.read_text(encoding='utf-8-sig'))
            ids = batch.get('sourceIds')
            if batch.get('schemaVersion') != 1 or not isinstance(ids, list) or len(ids) > 30 or any(not isinstance(value, str) for value in ids) or len(set(ids)) != len(ids):
                raise ValueError('Invalid refresh plan source IDs.')
            only = set(ids)
            # Honor oldest-attempt ordering even when the time budget stops early.
            order = {source_id: index for index, source_id in enumerate(ids)}
            manifest['sources'].sort(key=lambda source: order.get(source['id'], len(ids)))
        if not 1 <= args.budget_seconds <= 1800:
            raise ValueError('Invalid collection time budget.')
        output = collect(manifest, destinations, only=only, deadline_seconds=args.budget_seconds)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + '.tmp')
        temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(args.output)
    except (OSError, ValueError, TypeError, KeyError):
        print('Collection failed: check the source registry and output location.', file=sys.stderr)
        return 2
    print(json.dumps({'sources': len(output['sources']), 'successful': sum(source['status'] == 'ok' for source in output['sources']), 'places': sum(len(source['places']) for source in output['sources'])}))
    return 0 if any(source['status'] == 'ok' for source in output['sources']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
