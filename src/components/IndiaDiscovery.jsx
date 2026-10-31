import { useEffect, useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { destinationsForQuery, formatSourceDate, selectIndexPlaces, validateIndex } from '../lib/india-index.js';
import './india-discovery.css';

const providerNames = { osm: 'OpenStreetMap', wikivoyage: 'Wikivoyage', scrapling: 'Official tourism websites' };

function IndexedPlace({ place }) {
  return <article className="india-place">
    <div className="india-place-meta">{place.city}, {place.state} · {place.category}</div>
    <h4>{place.name}</h4>
    <p>{place.description || 'A named place recorded by community mappers. Read its sources for visitor information.'}</p>
    <div className="india-place-actions">
      <span>{place.discovery?.label || 'Worth investigating'}</span>
      {place.coordinates && <a href={`https://www.openstreetmap.org/?mlat=${place.coordinates.lat}&mlon=${place.coordinates.lng}#map=16/${place.coordinates.lat}/${place.coordinates.lng}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Map</a>}
    </div>
    <details>
      <summary>Sources & why it appears</summary>
      <p>Discovery fit {place.discovery?.score ?? '—'}/100 · {place.discovery?.confidence || 'low'} confidence. This is a search aid, not a visitor rating or proof that a place is hidden.</p>
      <ul>{(place.discovery?.reasons || []).map(reason => <li key={reason}>{reason}</li>)}</ul>
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
  const [offbeatOnly, setOffbeatOnly] = useState(false);
  const [limit, setLimit] = useState(6);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/india-index.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Index unavailable'); return response.json(); })
      .then(validateIndex).then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => { setDestinationId(null); setCategory('all'); setOffbeatOnly(false); setLimit(6); }, [query]);

  if (error) return <section className="india-discovery"><h3>India place index</h3><p role="status">The collected place index couldn’t load. The travel guides below are still available.</p></section>;
  if (!data) return <section className="india-discovery" aria-busy="true"><p>Loading the India place index…</p></section>;
  const matched = destinationsForQuery(data.destinations, query);
  const activeId = destinationId ?? (query ? matched.length === 1 ? matched[0].id : '' : 'gokarna');
  const destination = data.destinations.find(item => item.id === activeId);
  const found = selectIndexPlaces(data, { query, destinationId: activeId, category, offbeatOnly });
  const covered = data.destinations.filter(item => item.count > 0).length;
  const discussions = data.discussions.filter(item => activeId ? item.destinationId === activeId : matched.some(city => city.id === item.destinationId)).slice(0, 8);
  return <section className="india-discovery" aria-labelledby="india-index-heading">
    <div className="india-index-heading">
      <div><span className="section-eyebrow">COLLECTED FROM TRAVEL SOURCES</span><h3 id="india-index-heading">Explore the India place index</h3></div>
      <span>{data.places.length.toLocaleString('en-IN')} places · {covered}/{data.destinations.length} destinations</span>
    </div>
    <p className="india-explanation">Official tourism listings, community travel advice, and mapped locations. Refreshes are scheduled every 6 hours; source dates show what was actually collected. Visitor ratings are not available.</p>
    <div className="india-controls">
      <label>Destination<select aria-label="Index destination" value={activeId} onChange={event => { setDestinationId(event.target.value); setLimit(6); }}>
        <option value="">{query ? 'Matching destinations' : 'All India destinations'}</option>
        {matched.map(item => <option key={item.id} value={item.id}>{item.city} ({item.count || 0})</option>)}
      </select></label>
      <label>Kind of place<select aria-label="Index category" value={category} onChange={event => { setCategory(event.target.value); setLimit(6); }}>
        <option value="all">All kinds</option>{['Beaches', 'Nature', 'Trails', 'Culture', 'Attractions'].map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="india-offbeat"><input type="checkbox" checked={offbeatOnly} onChange={event => { setOffbeatOnly(event.target.checked); setLimit(6); }} /> Only places with an offbeat signal</label>
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
    {!found.length ? <p className="india-empty" role="status">{matched.length ? 'No collected places match these filters yet. Try another kind of place or turn off the offbeat filter.' : 'This destination is not covered by the collected India index yet. Try the travel-guide search below.'}</p> : <div className="india-place-grid">{found.slice(0, limit).map(place => <IndexedPlace key={`${place.destinationId}:${place.id}`} place={place} />)}</div>}
    {found.length > limit && <button className="secondary-button india-more" onClick={() => setLimit(value => value + 12)}>Show more places ({found.length - limit} remaining)</button>}
    <aside className="india-discussions">
      <h4>Traveller discussions & suggestions</h4>
      {discussions.length ? <><p>Indexed source links, collected periodically. Open the original thread for people’s latest comments. These are not verified reviews.</p><ul>{discussions.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} <ArrowUpRight size={13} /></a><small>{item.publishedAt ? ` Posted ${formatSourceDate(item.publishedAt)} ·` : ''} Found {formatSourceDate(item.retrievedAt)}{item.stale ? ' · Earlier collection' : ''}{item.collectionMethod === 'manual_search' ? ' · Manually checked link' : ''}</small></li>)}</ul></> : <p>No relevant discussion links were collected for this selection. Try the external searches below or check again after a refresh. We don’t infer reviews from guide text.</p>}
      {destination?.discussionStatus?.status === 'error' && <p>Discussion search was unavailable during the latest collection.</p>}
    </aside>
    <p className="india-attribution">Descriptions adapted from <a href="https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft" target="_blank" rel="noopener noreferrer">Wikivoyage contributors · CC BY-SA 4.0</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL</a>. <a href={`${import.meta.env.BASE_URL}data/india-index.json`}>Download the sourced data</a>.</p>
  </section>;
}
