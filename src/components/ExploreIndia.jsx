import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, MapPin } from 'lucide-react';
import { destinationsForQuery, formatSourceDate, mergeDiscoveryResults, selectIndexPlaces, validateIndex } from '../lib/india-index.js';
import { searchIndiaPlaces } from '../lib/india-live-search.js';

const placeKey = place => `${place.destinationId}:${place.id}`;
const crowdLabels = { quieter: 'Reported quieter', mixed: 'Crowds vary by time or area', busy: 'Higher crowds reported', unknown: 'Crowds unverified' };

function acrossDestinations(places) {
  const groups = new Map();
  for (const place of places) {
    const group = groups.get(place.destinationId) || [];
    group.push(place);
    groups.set(place.destinationId, group);
  }
  const result = [];
  while (groups.size) for (const [id, group] of groups) {
    result.push(group.shift());
    if (!group.length) groups.delete(id);
  }
  return result;
}

function PlaceCard({ place, saved, onSave }) {
  const crowd = place.crowd || { status: 'unknown', evidence: [] };
  const evidence = crowd.evidence || [];
  const primary = evidence[0] || place.sources[0];
  const coordinates = place.coordinates;
  const mapUrl = coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)
    ? `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lng}#map=16/${coordinates.lat}/${coordinates.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.area || place.city}, ${place.state || ''}, India`)}`;
  const description = evidence[0]?.claim || place.description || 'A place listed in public travel sources. Check the original source before visiting.';
  return <article className="discovery-card" data-crowd={crowd.status}>
    <div className="card-topline"><span>{place.city}{place.state && `, ${place.state}`}</span><button className="save-place" aria-label={`${saved ? 'Unsave' : 'Save'} ${place.name}`} aria-pressed={saved} onClick={() => onSave(place)}>{saved ? <Check size={18} /> : <Bookmark size={18} />}</button></div>
    <span className="place-kind">{place.category || 'Place'}</span>
    <h3>{place.name}</h3>
    {place.area && <span className="place-area">{place.area}</span>}
    <span className={`crowd-note ${crowd.status === 'quieter' ? 'is-quieter' : ''}`}>{crowdLabels[crowd.status] || crowdLabels.unknown}</span>
    <p className="place-summary">{description.length > 240 ? `${description.slice(0, 237).replace(/\s+\S*$/, '')}…` : description}</p>
    {place.accessNotes && <p className="access-note">{place.accessNotes}</p>}
    <div className="card-links">{primary && <a href={primary.url} target="_blank" rel="noopener noreferrer">Read source <ArrowUpRight size={14} /></a>}<a href={mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> {coordinates ? 'Map' : 'Find on map'}</a></div>
    <details className="place-details"><summary>Details & sources</summary>
      {evidence.length > 0 && <p>{crowd.confidence || 'Low'} confidence. Crowd reports describe the source’s context; weekends and seasons can differ.</p>}
      {description.length > 240 && <p>{description}</p>}
      {(crowd.reasons || []).map(reason => <p key={reason}>{reason}</p>)}
      {evidence.map((item, i) => <div key={`${item.url}:${i}`}><p>{item.claim}</p><a href={item.url} target="_blank" rel="noopener noreferrer">{item.publisher}</a><small>Source date: {item.publishedPeriod || formatSourceDate(item.sourceUpdatedAt)} · Checked {formatSourceDate(item.retrievedAt)}</small></div>)}
      {place.sources.map(source => <div key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher || source.title || 'Original source'}</a><small>Collected {formatSourceDate(source.retrievedAt)} · Updated {formatSourceDate(source.listingUpdatedAt || source.updatedAt)}</small>{source.license && <small>{source.license}{source.provider === 'scrapling' ? ' · Factual metadata and source link' : ' · Text adapted from this source'}</small>}</div>)}
    </details>
  </article>;
}

export default function ExploreIndia({ query, destinations, saved, savedView, onSave, onSearch }) {
  const [data, setData] = useState(null);
  const [indexError, setIndexError] = useState(false);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(9);
  const [showOther, setShowOther] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/india-index.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
      .then(validateIndex).then(index => {
        const metadata = new Map(index.destinations.map(item => [item.id, item]));
        setData({ ...index, destinations: destinations.map(item => ({ ...metadata.get(item.id), ...item })) });
      }).catch(() => { if (!controller.signal.aborted) setIndexError(true); });
    return () => controller.abort();
  }, [destinations]);

  const indexed = useMemo(() => data ? selectIndexPlaces(data, { query, crowdMode: 'all' }) : [], [data, query]);
  const matched = useMemo(() => destinationsForQuery(destinations, query, data?.places || []), [destinations, query, data]);
  const broadQuery = !query || matched.length === destinations.length;

  useEffect(() => { setLimit(9); setShowOther(false); }, [query, savedView]);
  useEffect(() => {
    setLive(null);
    setLoading(false);
    if ((!data && !indexError) || broadQuery || indexed.filter(item => item.crowd?.status === 'quieter').length >= 3) return;
    const controller = new AbortController();
    setLoading(true);
    searchIndiaPlaces(query, { signal: controller.signal, destinations })
      .then(result => { if (!controller.signal.aborted) setLive({ ...result, forQuery: query }); })
      .catch(() => { if (!controller.signal.aborted) setLive({ status: 'unavailable', places: [], forQuery: query }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, data, indexError, broadQuery, indexed, destinations, retry]);

  const currentLive = live?.forQuery === query ? live : null;
  const combined = useMemo(() => mergeDiscoveryResults(indexed, currentLive?.places || []), [indexed, currentLive]);
  const quieter = combined.filter(item => item.crowd?.status === 'quieter');
  const others = combined.filter(item => item.crowd?.status !== 'quieter' && item.crowd?.status !== 'busy');
  const ordered = broadQuery || matched.length > 1 ? acrossDestinations(quieter) : quieter;
  const visible = savedView ? saved : ordered;
  const savedIds = new Set(saved.map(placeKey));
  const card = place => <PlaceCard key={placeKey(place)} place={place} saved={savedIds.has(placeKey(place))} onSave={onSave} />;
  const title = savedView ? 'Your saved places' : broadQuery ? 'Quieter places across India' : `Places for “${query}”`;
  const discussionIds = new Set([...matched.map(item => item.id), ...combined.map(item => item.destinationId)]);
  const discussions = (data?.discussions || []).filter(item => discussionIds.has(item.destinationId)).slice(0, 4);

  return <section className="explore-results" aria-labelledby="results-title">
    <div className="results-heading"><h2 id="results-title">{title}</h2>{!savedView && !broadQuery && <button className="text-button" onClick={() => onSearch('')}>All India</button>}</div>
    {!savedView && <p className="results-caption">Quieter suggestions need a source that mentions fewer visitors. Reports aren’t live crowd counts.</p>}
    {savedView ? <>
      {!saved.length && <div className="empty-state"><h3>Keep a few places for later.</h3><p>Tap the bookmark on any place to save it on this device.</p><button className="text-button" onClick={() => onSearch('')}>Explore places →</button></div>}
      <div className="discovery-grid">{visible.slice(0, limit).map(card)}</div>
    </> : <>
      {!data && !indexError && <p role="status" className="search-status">Loading places across India…</p>}
      {indexError && <p role="status" className="search-status">The saved index couldn’t load. Search a city to look up its public travel guide.</p>}
      {loading && <p role="status" className="search-status">Looking up places in the public travel guide…</p>}
      {ordered.length > 0 && <div className="discovery-grid quieter-results">{visible.slice(0, limit).map(card)}</div>}
      {!ordered.length && (data || indexError) && <div className="empty-state" role="status"><h3>{loading ? 'Checking sources for this place…' : 'No confirmed quieter spots here yet.'}</h3><p>{others.length ? 'You can still explore the places below. We don’t have enough evidence to say they get fewer visitors.' : loading ? 'Any places we find will appear here with their source.' : 'Try a nearby city or a state. Coverage depends on what public travel guides and tourism sources provide.'}</p></div>}
      {currentLive?.status === 'unavailable' && currentLive.reason !== 'guide_not_available' && <p className="search-status" role="status">The public guide couldn’t be reached. {indexed.length ? 'Collected places are still available below. ' : ''}<button className="text-button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
      {others.length > 0 && <div className="other-places">
        {ordered.length > 0 && <button className="text-button other-toggle" aria-expanded={showOther} onClick={() => { setShowOther(value => !value); setLimit(9); }}>{showOther ? 'Hide other places' : `See other places (${others.length})`}</button>}
        {(!ordered.length || showOther) && <><div className="other-heading"><h2>More places to explore</h2><p>Crowd levels are unverified or depend on the time and area.</p></div><div className="discovery-grid other-results">{others.slice(0, limit).map(card)}</div>{others.length > limit && <button className="load-more" onClick={() => setLimit(value => value + 12)}>Show more places</button>}</>}
      </div>}
    </>}
    {visible.length > limit && <button className="load-more" onClick={() => setLimit(value => value + 12)}>Show more quieter places</button>}
    {!savedView && !broadQuery && <aside className="traveller-links"><h2>From other travellers</h2><p>Open the original discussions for tips and recent comments.</p>{discussions.length > 0 && <ul>{discussions.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a></li>)}</ul>}<a href={`https://www.reddit.com/search/?q=${encodeURIComponent(`${matched.length === 1 ? matched[0].city : query} India quiet places`)}`} target="_blank" rel="noopener noreferrer">Search traveller discussions on Reddit ↗</a></aside>}
    <details className="coverage-details"><summary>About the sources & coverage</summary><p>Search Indian cities, states, and place names. {destinations.length} destination areas are configured; public Wikivoyage lookup also checks other Indian cities. {data ? `${data.places.length.toLocaleString('en-IN')} records are currently indexed across ${data.destinations.filter(item => item.count > 0).length} destinations.` : ''} Some places have no public listing or crowd evidence yet.</p><p>Tourism pages are collected periodically. Guide lookup runs when a search needs more data. We link to traveller discussions; we don’t collect live visitor counts or invent ratings.</p><p>Descriptions adapted from <a href="https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft" target="_blank" rel="noopener noreferrer">Wikivoyage contributors · CC BY-SA 4.0</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL</a>. <a href={`${import.meta.env.BASE_URL}data/india-index.json`}>Download sourced data</a>.</p></details>
  </section>;
}
