import { useState } from 'react';
import { ArrowRight, Bookmark, Compass, Search } from 'lucide-react';
import destinations from '../data/india-destinations.json';
import ExploreIndia from './components/ExploreIndia.jsx';
import { validateIndex } from './lib/india-index.js';
import './simple.css';

const STORAGE_KEY = 'elsewhere:saved-index-places:v1';
const suggestions = ['Coorg', 'Goa', 'Jaipur', 'Shillong', 'Varkala', 'Hyderabad'];
const options = [...new Set(destinations.flatMap(item => [item.city, item.state, ...item.aliases]))].sort();

function loadSaved() {
  try {
    const places = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return validateIndex({ schemaVersion: 1, destinations: [], places }).places.slice(0, 200);
  } catch { return []; }
}

export default function PublicApp() {
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q')?.slice(0, 160) || '');
  const [input, setInput] = useState(query);
  const [saved, setSaved] = useState(loadSaved);
  const [savedView, setSavedView] = useState(false);
  const [notice, setNotice] = useState('');

  function search(value) {
    const next = value.trim().slice(0, 160);
    setInput(next);
    setQuery(next);
    setSavedView(false);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('q', next); else url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
  }

  function toggleSaved(place) {
    const key = `${place.destinationId}:${place.id}`;
    setSaved(current => {
      const exists = current.some(item => `${item.destinationId}:${item.id}` === key);
      const next = exists ? current.filter(item => `${item.destinationId}:${item.id}` !== key) : [...current, place].slice(-200);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch { setNotice('Saved for this visit. Your browser could not store it for next time.'); }
      return next;
    });
  }

  return <div className="simple-app">
    <a className="skip-link" href="#discover">Skip to places</a>
    <header className="simple-header">
      <button className="wordmark" onClick={() => search('')} aria-label="Elsewhere home"><Compass size={24} strokeWidth={1.6} /> elsewhere<span>India</span></button>
      <button className={`saved-nav ${savedView ? 'is-active' : ''}`} onClick={() => setSavedView(value => !value)} aria-pressed={savedView}><Bookmark size={17} /> {savedView ? 'Back to explore' : `Saved${saved.length ? ` (${saved.length})` : ''}`}</button>
    </header>
    <main>
      <section className="search-intro" aria-labelledby="intro-title">
        <span className="intro-label">A LITTLE FURTHER FROM THE CROWDS</span>
        <h1 id="intro-title">Find a quieter corner of India.</h1>
        <p>Search a city, state, or place. Discover spots worth exploring, with sources you can check.</p>
        <form className="destination-search" role="search" onSubmit={event => { event.preventDefault(); search(input); }}>
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="destination">Search places in India</label>
          <input id="destination" type="search" value={input} onChange={event => setInput(event.target.value)} placeholder="Try Jaipur, Kerala, or #hiddenplacegokarna" maxLength={160} list="india-destinations" autoComplete="off" />
          <datalist id="india-destinations">{options.map(option => <option key={option} value={option} />)}</datalist>
          <button type="submit">Find places <ArrowRight size={17} /></button>
        </form>
        <div className="suggestions" aria-label="Try a destination"><span>Try</span>{suggestions.map(city => <button key={city} onClick={() => search(city)}>{city}</button>)}</div>
      </section>
      {notice && <p className="storage-notice" role="status">{notice}</p>}
      <div id="discover"><ExploreIndia query={query} destinations={destinations} saved={saved} savedView={savedView} onSave={toggleSaved} onSearch={search} /></div>
    </main>
    <footer className="simple-footer"><span>Go gently. Leave places as you found them.</span><a href="https://github.com/ArunMandava3030/finder" target="_blank" rel="noopener noreferrer">About the project ↗</a></footer>
  </div>;
}
