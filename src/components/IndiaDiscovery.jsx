import { useEffect, useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { destinationsForQuery, formatSourceDate, selectIndexPlaces, validateIndex } from '../lib/india-index.js';
import './india-discovery.css';

const providerNames = { osm: 'OpenStreetMap', wikivoyage: 'Wikivoyage', scrapling: 'Official tourism websites' };
const crowdLabels = { quieter: 'Reported quieter', mixed: 'Mixed or conditional reports', busy: 'Higher crowds reported', unknown: 'Crowd levels unknown' };

function EvidenceDate({ evidence }) {
  const period = evidence.publishedPeriod;
  const published = /^\d{4}-\d{2}$/.test(period || '')
    ? new Date(`${period}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : formatSourceDate(evidence.sourceUpdatedAt);
  return <small>Source date: {published} · Checked {formatSourceDate(evidence.retrievedAt)}{evidence.stale ? ' · Older evidence' : ''}</small>;
}

function IndexedPlace({ place }) {
  const crowd = place.crowd || { status: 'unknown', evidence: [] };
  const evidence = crowd.evidence || [];
  return <article className="india-place">
    <div className="india-place-meta">{place.city}, {place.state} · {place.category}</div>
    <h4>{place.name}</h4>
    {place.area && <small>{place.area}</small>}
    <p>{place.description || 'A named place recorded by community mappers. Read its sources for visitor information.'}</p>
    <div className="india-place-actions">
      <span>{crowdLabels[crowd.status] || crowdLabels.unknown}</span>
      {place.coordinates ? <a href={`https://www.openstreetmap.org/?mlat=${place.coordinates.lat}&mlon=${place.coordinates.lng}#map=16/${place.coordinates.lat}/${place.coordinates.lng}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Map</a> : <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.area || place.city}, ${place.state}, India`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Search map</a>}
    </div>
    <div className="india-crowd-evidence">
      {evidence.length ? <><strong>What supports this</strong><p>{evidence[0].claim}</p><a href={evidence[0].url} target="_blank" rel="noopener noreferrer">{evidence[0].publisher} <ArrowUpRight size={13} /></a><EvidenceDate evidence={evidence[0]} /></> : <p>No place-specific crowd evidence collected. A map pin or a “hidden gem” label does not establish fewer visitors.</p>}
      {crowd.status === 'mixed' && <p>{crowd.reasons?.join(' ') || 'Reports vary or apply only to a particular time or area.'}</p>}
      {place.accessNotes && <p>{place.accessNotes}</p>}
    </div>
    <details>
      <summary>Sources & why it appears</summary>
      <p>{crowd.confidence || 'low'} confidence · Reports describe the source’s context, not how many people are there now. Weekends, holidays, and seasons can change crowds.</p>
      <ul>{(crowd.reasons || []).map(reason => <li key={reason}>{reason}</li>)}</ul>
      {evidence.slice(1).map((item, i) => <div className="india-source" key={`${item.url}:${i}`}><p>{item.claim}</p><a href={item.url} target="_blank" rel="noopener noreferrer">{item.publisher}</a><EvidenceDate evidence={item} /></div>)}
      {place.sources.map(source => <div className="india-source" key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher}: {source.title || place.name} <ArrowUpRight size={13} /></a>
        <small>Collected {formatSourceDate(source.retrievedAt)} · Source updated {formatSourceDate(source.updatedAt)}{source.listingUpdatedAt ? ` · Listing updated ${formatSourceDate(source.listingUpdatedAt)}` : ''}</small>
        {source.license && <small>{source.license}{source.provider === 'scrapling' ? ' · Place name and source link' : ' · Text adapted from the linked source'}</small>}
      </div>)}
    </details>
  </article>;
}

export default function IndiaDiscovery({ query = '' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [destinationId, setDestinationId] = useState(null);
  const [category, setCategory] = useState('all');
  const [crowdMode, setCrowdMode] = useState('quieter');
  const [limit, setLimit] = useState(6);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/india-index.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Index unavailable'); return response.json(); })
      .then(validateIndex).then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => { setDestinationId(null); setCategory('all'); setCrowdMode('quieter'); setLimit(6); }, [query]);

  if (error) return <section className="india-discovery"><h3>Quieter places</h3><p role="status">The collected place index couldn’t load. Quiet-place recommendations are unavailable. You can open the general travel guides separately below.</p></section>;
  if (!data) return <section className="india-discovery" aria-busy="true"><p>Loading the India place index…</p></section>;
  const matched = destinationsForQuery(data.destinations, query);
  const activeId = destinationId ?? (query ? matched.length === 1 ? matched[0].id : '' : 'gokarna');
  const destination = data.destinations.find(item => item.id === activeId);
  const found = selectIndexPlaces(data, { query, destinationId: activeId, category, crowdMode });
  const allMatching = selectIndexPlaces(data, { query, destinationId: activeId, category, crowdMode: 'all' });
  const covered = data.destinations.filter(item => item.count > 0).length;
  const discussions = data.discussions.filter(item => activeId ? item.destinationId === activeId : matched.some(city => city.id === item.destinationId)).slice(0, 8);
  return <section className="india-discovery" aria-labelledby="india-index-heading">
    <div className="india-index-heading">
      <div><span className="section-eyebrow">FEWER CROWDS, WITH SOURCE EVIDENCE</span><h3 id="india-index-heading">Find quieter places</h3></div>
      <span>{found.length} matches · {covered} destinations indexed</span>
    </div>
    <p className="india-explanation">Quieter suggestions need a source that specifically discusses fewer visitors. “Hidden,” scenic, or well documented is not enough. Reports are refreshed periodically; there are no live crowd counts. Visitor ratings are not available.</p>
    <div className="india-controls">
      <label>Destination<select aria-label="Index destination" value={activeId} onChange={event => { setDestinationId(event.target.value); setLimit(6); }}>
        <option value="">{query ? 'Matching destinations' : 'All India destinations'}</option>
        {matched.map(item => <option key={item.id} value={item.id}>{item.city} ({item.count || 0})</option>)}
      </select></label>
      <label>Kind of place<select aria-label="Index category" value={category} onChange={event => { setCategory(event.target.value); setLimit(6); }}>
        <option value="all">All kinds</option>{['Beaches', 'Nature', 'Trails', 'Culture', 'Attractions'].map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label>Evidence filter<select aria-label="Crowd evidence" value={crowdMode} onChange={event => { setCrowdMode(event.target.value); setLimit(6); }}><option value="quieter">Quieter evidence only</option><option value="mixed">Mixed or time-dependent reports</option><option value="all">All places, including unknown crowds</option></select></label>
    </div>
    {destination && <div className="india-coverage">
      <strong>{destination.city}</strong> · {found.length} matching places · Collected {formatSourceDate(destination.fetchedAt)}
      {destination.status !== 'ok' && <span>Partial coverage{destination.status === 'stale' ? ' · Showing earlier data' : ''}</span>}
      <details><summary>Collection status</summary>
        {(destination.providers || []).map(provider => <p key={provider.provider}>{providerNames[provider.provider] || 'Other travel source'}: {provider.status}{Number.isFinite(provider.count) ? ` (${provider.count} places)` : ''}</p>)}
        {(destination.warnings || []).map((warning, i) => <p key={i}>{warning}</p>)}
        <p>Last attempt: {formatSourceDate(destination.attemptedAt)}. Page revision dates can reflect edits elsewhere in the guide; check the original listing for current access.</p>
      </details>
    </div>}
    {crowdMode !== 'all' && allMatching.length > found.length && <p className="india-explanation">{allMatching.length - found.length} other records excluded from this view. Their crowd evidence is missing or does not match this filter.</p>}
    {!found.length ? <p className="india-empty" role="status">{matched.length ? crowdMode === 'quieter' ? 'We don’t have enough specific evidence to suggest a quieter place for these filters yet. Try a nearby destination, or explicitly choose all places to inspect unknown crowd levels.' : 'No collected places match these filters.' : 'This destination is not covered by the collected India index yet. You can open the general travel guides below.'}</p> : <div className="india-place-grid">{found.slice(0, limit).map(place => <IndexedPlace key={`${place.destinationId}:${place.id}`} place={place} />)}</div>}
    {found.length > limit && <button className="secondary-button india-more" onClick={() => setLimit(value => value + 12)}>Show more places ({found.length - limit} remaining)</button>}
    <aside className="india-discussions">
      <h4>Traveller discussions & suggestions</h4>
      {discussions.length ? <><p>Indexed source links, collected periodically. Open the original thread for people’s latest comments. These are not verified reviews.</p><ul>{discussions.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} <ArrowUpRight size={13} /></a><small>{item.publishedAt ? ` Posted ${formatSourceDate(item.publishedAt)} ·` : ''} Found {formatSourceDate(item.retrievedAt)}{item.stale ? ' · Earlier collection' : ''}{item.collectionMethod === 'manual_search' ? ' · Manually checked link' : ''}</small></li>)}</ul></> : <p>No relevant discussion links were collected for this selection. Try the external searches below or check again after a refresh. We don’t infer reviews from guide text.</p>}
      {destination?.discussionStatus?.status === 'error' && <p>Discussion search was unavailable during the latest collection.</p>}
    </aside>
    <p className="india-attribution">Descriptions adapted from <a href="https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft" target="_blank" rel="noopener noreferrer">Wikivoyage contributors · CC BY-SA 4.0</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL</a>. <a href={`${import.meta.env.BASE_URL}data/india-index.json`}>Download the sourced data</a>.</p>
  </section>;
}
