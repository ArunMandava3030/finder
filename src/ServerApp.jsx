import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  Compass,
  ExternalLink,
  Globe2,
  Instagram,
  LayoutGrid,
  Leaf,
  List,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Mountain,
  Navigation,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trees,
  Waves,
  X,
  Landmark,
} from "lucide-react";
import { places } from "./data/places.js";
import { searchPublicGuides } from "./lib/public-search.js";
import IndiaDiscovery from "./components/IndiaDiscovery.jsx";
import {
  categories,
  filterPlaces,
  loadSavedPlaces,
  normalizeLocalQuery,
} from "./lib/discovery.js";

const categoryIcons = {
  "All discoveries": Compass,
  Beaches: Waves,
  Nature: Trees,
  Trails: Mountain,
  Culture: Landmark,
};
const cities = [
  "All destinations",
  ...new Set(places.map((place) => place.city)),
];
const sourceLabels = {
  all: "All sources",
  web: "Travel sites",
  reddit: "Reddit",
  instagram: "Instagram",
};
const sourceIcons = {
  all: Globe2,
  web: Globe2,
  reddit: MessageCircle,
  instagram: Instagram,
  wikipedia: Globe2,
  wikivoyage: Compass,
};
const PUBLIC_SEARCH = import.meta.env.VITE_SEARCH_MODE !== "server";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const publicSourceLabels = {
  all: "All guides",
  wikivoyage: "Wikivoyage",
  wikipedia: "Wikipedia",
};
const resultSourceLabels = PUBLIC_SEARCH ? publicSourceLabels : sourceLabels;
const assetUrl = (path) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const heroImage = assetUrl("images/konkan-coast.jpg");

function BroaderSearch({ query }) {
  const destination =
    normalizeLocalQuery(query) || query.replace(/#/g, " ").trim();
  const webQuery = `${destination} hidden places travel tips`;
  return (
    <aside
      className="broader-search"
      aria-label="Broader web and social searches"
    >
      <div>
        <Globe2 size={18} />
        <p>
          <strong>Follow the conversation further.</strong>
          <span>
            These links open external searches for stories, suggestions, and
            reviews.
          </span>
        </p>
      </div>
      <div className="broader-search-links">
        <a
          href={`https://duckduckgo.com/?q=${encodeURIComponent(webQuery)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Search the web
          <ArrowUpRight size={14} />
        </a>
        <a
          href={`https://www.reddit.com/search/?q=${encodeURIComponent(`${destination} travel tips`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Search Reddit
          <ArrowUpRight size={14} />
        </a>
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${destination} hidden places`)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Find public Instagram posts through Google"
        >
          Search Instagram
          <ArrowUpRight size={14} />
        </a>
      </div>
    </aside>
  );
}

function Modal({ title, children, onClose, className = "" }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [
        ...panel.current.querySelectorAll(
          'button, a[href], input, select, [tabindex="0"]',
        ),
      ].filter((el) => !el.disabled);
    focusable()[0]?.focus();
    function handleKey(event) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        {children}
      </section>
    </div>
  );
}

function PlaceCard({ place, saved, onSave, onOpen, index }) {
  return (
    <article
      className="place-card"
      style={{ "--card-delay": `${Math.min(index, 5) * 55}ms` }}
    >
      <div className="card-image-wrap">
        <button
          className="card-image-button"
          onClick={() => onOpen(place)}
          aria-label={`Explore ${place.name}`}
        >
          <img
            src={assetUrl(place.image)}
            alt={place.imageAlt}
            loading="lazy"
          />
        </button>
        <span className="category-label">
          {place.featured ? <Sparkles size={12} /> : <MapPin size={12} />}
          {place.featured ? "Field guide" : place.category}
        </span>
        <button
          className={`save-button ${saved ? "is-saved" : ""}`}
          onClick={() => onSave(place.id)}
          aria-label={`${saved ? "Unsave" : "Save"} ${place.name}`}
          aria-pressed={saved}
        >
          <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
        </button>
        <span className="image-category">{place.category}</span>
      </div>
      <div className="card-content">
        <div className="place-location">
          <MapPin size={12} />
          {place.city}, {place.region}
        </div>
        <button className="card-title" onClick={() => onOpen(place)}>
          <h3>{place.name}</h3>
          <ArrowUpRight size={20} />
        </button>
        <p>{place.description}</p>
        <div className="card-bottom">
          <span>
            <Globe2 size={13} />
            {place.sources.length}{" "}
            {place.sources.length === 1
              ? "original source"
              : "original sources"}
            {place.sources.some((item) => item.kind === "reddit") && (
              <MessageCircle
                size={12}
                aria-label="Includes Reddit discussions"
              />
            )}
          </span>
          <button onClick={() => onOpen(place)}>
            Take a look <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function SourceResult({ result }) {
  const Icon = sourceIcons[result.source] || Globe2;
  return (
    <article className="web-result">
      <div className={`source-avatar ${result.source}`}>
        <Icon size={20} />
      </div>
      <div className="web-result-body">
        <span className="web-result-domain">
          {result.domain} <span>·</span>{" "}
          {result.domain?.includes("wikivoyage.org")
            ? "Travel guide"
            : result.domain?.includes("wikipedia.org")
              ? "Encyclopedia"
              : sourceLabels[result.source] || "Website"}
        </span>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <h3>{result.title}</h3>
          <ArrowUpRight size={19} />
        </a>
        <p>
          {result.excerpt ||
            "Open the original source to read this story and any available reviews."}
        </p>
      </div>
    </article>
  );
}

export default function App() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All discoveries");
  const [city, setCity] = useState("All destinations");
  const [savedIds, setSavedIds] = useState(loadSavedPlaces);
  const [savedView, setSavedView] = useState(false);
  const [layout, setLayout] = useState("grid");
  const [limit, setLimit] = useState(6);
  const [modal, setModal] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [tab, setTab] = useState("guide");
  const [source, setSource] = useState("all");
  const [searchData, setSearchData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [health, setHealth] = useState(null);
  const request = useRef(null);
  const resultsRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    if (PUBLIC_SEARCH) {
      setHealth({
        ok: true,
        search: { configured: true, provider: "wikimedia" },
      });
      return () => {
        request.current?.abort();
      };
    }
    fetch(`${API_BASE}/api/health`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then(setHealth)
      .catch(() => {});
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);

  const foundPlaces = filterPlaces(places, {
    query,
    category,
    city,
    savedIds: savedView ? savedIds : null,
  });
  const webResults = (searchData?.results || []).filter(
    (result) =>
      source === "all" ||
      (PUBLIC_SEARCH
        ? result.domain?.endsWith(`${source}.org`)
        : result.source === source),
  );
  const visiblePlaces = foundPlaces.slice(0, limit);
  const hasFilters =
    category !== "All discoveries" || city !== "All destinations";

  function savePlace(id) {
    const next = savedIds.includes(id)
      ? savedIds.filter((saved) => saved !== id)
      : [...savedIds, id];
    setSavedIds(next);
    try {
      localStorage.setItem("elsewhere:saved", JSON.stringify(next));
    } catch {
      setStorageNotice(
        "Saved for this visit. Your browser couldn’t store these places for next time.",
      );
    }
  }

  function goDiscover(saved = false) {
    request.current?.abort();
    setLoading(false);
    setSavedView(saved);
    setQuery("");
    setInput("");
    setCategory("All discoveries");
    setCity("All destinations");
    setTab("guide");
    setLimit(6);
    setNotice("");
    setSearchData(null);
    if (saved)
      setTimeout(
        () =>
          resultsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        20,
      );
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function search(event, suggestedQuery) {
    event?.preventDefault();
    const value = (suggestedQuery ?? input).trim();
    if (value.length < 2) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setInput(value);
    setQuery(value);
    setSavedView(false);
    setCategory("All discoveries");
    setCity("All destinations");
    setSource("all");
    setLimit(6);
    setLoading(true);
    setNotice("");
    setSearchData(null);
    setTab("web");
    setTimeout(
      () =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
    try {
      const response = PUBLIC_SEARCH
        ? null
        : await fetch(
            `${API_BASE}/api/search?q=${encodeURIComponent(value)}&source=all`,
            { signal: controller.signal },
          );
      const data = PUBLIC_SEARCH
        ? await searchPublicGuides(value, { signal: controller.signal })
        : await response.json();
      if (controller.signal.aborted) return;
      setSearchData(data);
      if (response && !response.ok) {
        setNotice(
          data.configured === false
            ? "Live search is not connected yet. In the meantime, explore our sourced field guide below."
            : data.error?.message ||
                "Web search is taking a break. You can still explore the field guide.",
        );
        setTab("guide");
      } else if (!data.results?.length) {
        setNotice(
          PUBLIC_SEARCH
            ? "No public travel guides matched this search. Try a city name, or follow the broader search links below."
            : "No indexed web results came back for this search. Try a city name or a different description.",
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && error.name !== "AbortError") {
        setNotice(
          PUBLIC_SEARCH
            ? "The public guides couldn’t be reached just now. Explore our field guide or use the broader search links below."
            : "We couldn’t reach web search. Our sourced field guide is still here to explore.",
        );
        setTab("guide");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function resetFilters() {
    request.current?.abort();
    setLoading(false);
    setSearchData(null);
    setTab("guide");
    setCategory("All discoveries");
    setCity("All destinations");
    setQuery("");
    setInput("");
    setLimit(6);
    setNotice("");
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => goDiscover()}
            aria-label="Elsewhere home"
          >
            <span className="brand-mark">
              <Compass size={25} strokeWidth={1.5} />
            </span>
            elsewhere<span className="brand-dot">.</span>
          </button>
          <nav aria-label="Main navigation">
            <button
              className={!savedView ? "nav-link active" : "nav-link"}
              onClick={() => goDiscover()}
            >
              Discover
            </button>
            <button
              className={savedView ? "nav-link active" : "nav-link"}
              onClick={() => goDiscover(true)}
            >
              <Bookmark size={15} />
              Saved places
              {savedIds.length > 0 && (
                <span className="saved-count">{savedIds.length}</span>
              )}
            </button>
            <button
              className="nav-link how-link"
              onClick={() => setModal("how")}
            >
              How it works
              <ArrowUpRight size={14} />
            </button>
          </nav>
          <span className="header-note">
            <Sun size={17} /> A little more wander.
          </span>
        </div>
      </header>

      <main className="page-shell">
        <section className="hero" aria-labelledby="hero-heading">
          <img
            className="hero-image"
            src={heroImage}
            alt="Palm-lined coastline with quiet coves and the Arabian Sea"
            fetchPriority="high"
          />
          <div className="hero-shade" />
          <div className="hero-content">
            <span className="eyebrow">
              <span /> LESS SCROLLING. MORE EXPLORING.
            </span>
            <h1 id="hero-heading">
              Find your kind
              <br />
              of <em>nowhere.</em>
              <span className="heading-star">✳</span>
            </h1>
            <p>
              Find places with fewer crowds.
              <br className="desktop-break" /> All the good stuff, brought
              together with source evidence and dates.
            </p>
          </div>
          <div className="hero-location">
            <span className="location-line" />
            <MapPin size={15} />
            <div>
              Somewhere along the Konkan coast
              <span>A little inspiration for your next escape</span>
            </div>
          </div>
          <div className="hero-index">
            <span>01</span> / THE ART OF GETTING LOST
          </div>
        </section>

        <section className="search-section" aria-label="Discover a destination">
          <form className="search-box" onSubmit={search}>
            <span className="search-symbol">
              <Search size={23} strokeWidth={1.7} />
            </span>
            <div className="search-input-wrap">
              <label htmlFor="destination">
                WHERE DOES YOUR CURIOSITY TAKE YOU?
              </label>
              <input
                id="destination"
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Try a city, a feeling, or #hiddenplacegokarna"
                maxLength={160}
                minLength={2}
                required
                autoComplete="off"
              />
            </div>
            <button
              className="search-submit"
              type="submit"
              aria-label="Find my elsewhere"
              disabled={loading}
            >
              {loading ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  <span>Find my elsewhere</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="trending">
            <span>Follow a little curiosity</span>
            <button onClick={() => search(null, "#hiddenplacegokarna")}>
              #hiddenplacegokarna <ArrowUpRight size={12} />
            </button>
            <button onClick={() => search(null, "#hiddenplacescoorg")}>
              #hiddenplacescoorg <ArrowUpRight size={12} />
            </button>
            <button onClick={() => search(null, "#offbeathampi")}>
              #offbeathampi <ArrowUpRight size={12} />
            </button>
          </div>
        </section>

        <div className="value-strip">
          <span>
            <Compass size={17} /> Find the less obvious
          </span>
          <i />
          <span>
            <MessageCircle size={17} /> Stories from real sources
          </span>
          <i />
          <span>
            <Bookmark size={16} /> Keep your next adventure close
          </span>
        </div>

        <section
          className="discover-section"
          ref={resultsRef}
          id="discover"
          aria-labelledby="discover-heading"
        >
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">
                {savedView
                  ? "YOUR PERSONAL LITTLE FIELD GUIDE"
                  : query
                    ? "LET YOUR CURIOSITY LEAD"
                    : "GOOD PLACES. GREAT LITTLE STORIES."}
              </span>
              <h2 id="discover-heading">
                {savedView
                  ? "For your someday list."
                  : query
                    ? "Quieter places to explore."
                    : "Find places with fewer crowds."}
              </h2>
              <p>
                {savedView
                  ? "The places you’ve bookmarked, ready when you are."
                  : query
                    ? `Following the trail for “${query}”`
                    : "Start with what sources actually say about visitor numbers."}
              </p>
            </div>
            <span className="field-note">
              <Leaf size={17} /> Go gently. Leave it lovely.
            </span>
          </div>

          {!savedView && <IndiaDiscovery query={query} />}

          <details className="general-guides" key={`${query}:${savedView}`} open={savedView || !PUBLIC_SEARCH ? true : undefined}>
          {!savedView && <><summary>General travel guides — crowd levels unverified</summary><p className="general-guides-note">These guides include popular attractions and editorial selections. They are background information; quieter suggestions appear above.</p></>}

          {(query || savedView) && (
            <div className="result-tabs">
              {!savedView && (
                <>
                  <button
                    className={tab === "guide" ? "selected" : ""}
                    onClick={() => setTab("guide")}
                  >
                    <Compass size={15} />
                    Field guide <span>{foundPlaces.length}</span>
                  </button>
                  <button
                    className={tab === "web" ? "selected" : ""}
                    onClick={() => setTab("web")}
                  >
                    <Globe2 size={15} />
                    {PUBLIC_SEARCH ? "Travel guides" : "Across the web"}{" "}
                    {loading ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <span>{searchData?.results?.length || 0}</span>
                    )}
                  </button>
                </>
              )}
              <button className="clear-search" onClick={() => goDiscover()}>
                <X size={14} />
                {savedView ? "Back to discovering" : "Clear search"}
              </button>
            </div>
          )}

          {notice && (
            <div className="search-notice" role="status">
              <Globe2 size={19} />
              <p>{notice}</p>
              {searchData?.configured === false && (
                <button onClick={() => setModal("connect")}>
                  Connect search <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          )}
          {storageNotice && (
            <p className="storage-notice" role="status">
              {storageNotice}
            </p>
          )}
          {PUBLIC_SEARCH && query && <BroaderSearch query={query} />}

          <div className="filter-bar">
            <div
              className="category-tabs"
              aria-label={
                tab === "guide" ? "Filter by category" : "Filter by source"
              }
            >
              {tab === "guide"
                ? categories.map((item) => {
                    const Icon = categoryIcons[item];
                    return (
                      <button
                        key={item}
                        className={
                          category === item ? "category active" : "category"
                        }
                        aria-pressed={category === item}
                        onClick={() => {
                          setCategory(item);
                          setLimit(6);
                        }}
                      >
                        <Icon size={16} />
                        {item}
                      </button>
                    );
                  })
                : Object.entries(resultSourceLabels).map(([key, label]) => {
                    const Icon = sourceIcons[key];
                    return (
                      <button
                        key={key}
                        className={
                          source === key ? "category active" : "category"
                        }
                        aria-pressed={source === key}
                        onClick={() => setSource(key)}
                      >
                        <Icon size={16} />
                        {label}
                      </button>
                    );
                  })}
            </div>
            {tab === "guide" && (
              <div className="filter-control">
                <button
                  className={`filter-button ${hasFilters ? "has-filters" : ""}`}
                  onClick={() => setShowFilters(!showFilters)}
                  aria-expanded={showFilters}
                >
                  <SlidersHorizontal size={16} />
                  Filters{hasFilters && <span className="filter-dot" />}
                </button>
                {showFilters && (
                  <div className="filter-popover">
                    <label htmlFor="city-filter">Your next destination</label>
                    <select
                      id="city-filter"
                      value={city}
                      onChange={(event) => {
                        setCity(event.target.value);
                        setLimit(6);
                      }}
                    >
                      {cities.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        resetFilters();
                        setShowFilters(false);
                      }}
                    >
                      Reset filters
                    </button>
                    <button
                      className="apply-filter"
                      onClick={() => setShowFilters(false)}
                    >
                      Done <Check size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="results-meta">
            <span>
              {tab === "guide" ? (
                <>
                  <strong>
                    {foundPlaces.length}{" "}
                    {foundPlaces.length === 1 ? "place" : "places"}
                  </strong>{" "}
                  {savedView ? "waiting for you" : "to spark your next detour"}
                  <span className="curated-label">
                    Sourced field guide · Photo details inside
                  </span>
                </>
              ) : (
                <>
                  <strong>{webResults.length} sources</strong>{" "}
                  {PUBLIC_SEARCH ? "from public guides" : "from the public web"}
                  {searchData?.retrievedAt && (
                    <span className="curated-label">
                      Retrieved{" "}
                      {new Date(searchData.retrievedAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}
                    </span>
                  )}
                </>
              )}
            </span>
            {tab === "guide" && (
              <div className="view-controls" aria-label="Result layout">
                <button
                  aria-label="Grid view"
                  aria-pressed={layout === "grid"}
                  className={layout === "grid" ? "active" : ""}
                  onClick={() => setLayout("grid")}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  aria-label="List view"
                  aria-pressed={layout === "list"}
                  className={layout === "list" ? "active" : ""}
                  onClick={() => setLayout("list")}
                >
                  <List size={18} />
                </button>
              </div>
            )}
          </div>
          {tab === "web" &&
            !loading &&
            searchData?.warnings
              ?.filter((warning) => warning.includes("could not"))
              .map((warning, index) => (
                <div className="search-notice" role="status" key={index}>
                  <Globe2 size={17} />
                  <p>{warning}</p>
                </div>
              ))}

          {tab === "guide" ? (
            foundPlaces.length > 0 ? (
              <>
                <div
                  className={`places-grid ${layout === "list" ? "list-layout" : ""}`}
                >
                  {visiblePlaces.map((place, index) => (
                    <PlaceCard
                      key={place.id}
                      place={place}
                      saved={savedIds.includes(place.id)}
                      onSave={savePlace}
                      onOpen={setSelectedPlace}
                      index={index}
                    />
                  ))}
                </div>
                {foundPlaces.length > limit && (
                  <div className="load-more-wrap">
                    <button
                      className="load-more"
                      onClick={() => setLimit(limit + 6)}
                    >
                      There’s more out there <ArrowDown size={16} />
                    </button>
                    <span>
                      {Math.min(limit, foundPlaces.length)} of{" "}
                      {foundPlaces.length} places. A world of possibilities.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <Compass size={35} strokeWidth={1.2} />
                <h3>
                  {savedView
                    ? "Your next adventure starts with a bookmark."
                    : "A little further off our map."}
                </h3>
                <p>
                  {savedView
                    ? "Save a place that catches your eye and you’ll find it here."
                    : "Our field guide doesn’t cover this combination yet. Try another destination or check the web results."}
                </p>
                <button
                  className="primary-button"
                  onClick={savedView ? () => goDiscover() : resetFilters}
                >
                  {savedView ? "Explore places" : "Explore the field guide"}
                  <ArrowRight size={16} />
                </button>
              </div>
            )
          ) : loading ? (
            <div className="search-loading" role="status">
              <div className="loading-orbit">
                <Compass size={32} />
              </div>
              <h3>Following a few promising trails…</h3>
              <p>
                {PUBLIC_SEARCH
                  ? "Looking for destination guides, places to see, and things to do."
                  : "Looking for places, stories, and conversations across the web."}
              </p>
            </div>
          ) : webResults.length ? (
            <>
              <div className="web-results">
                {webResults.map((result) => (
                  <SourceResult key={result.id} result={result} />
                ))}
              </div>
              <p className="source-disclaimer">
                {PUBLIC_SEARCH ? (
                  <>
                    Guide excerpts come from{" "}
                    <a
                      href="https://en.wikivoyage.org/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Wikivoyage
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://en.wikipedia.org/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Wikipedia
                    </a>{" "}
                    contributors under{" "}
                    <a
                      href="https://creativecommons.org/licenses/by-sa/4.0/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      CC BY-SA
                    </a>
                    . Each result links to its original page. These are
                    travel-guide entries, not visitor reviews.
                  </>
                ) : (
                  "Search excerpts come from the original pages. Open a source for the full story, reviews, and latest visitor advice."
                )}
              </p>
              {searchData?.warnings
                ?.filter((warning) => !warning.includes("could not"))
                .map((warning, index) => (
                  <p className="source-disclaimer" key={index}>
                    {warning}
                  </p>
                ))}
            </>
          ) : (
            <div className="empty-state">
              <Globe2 size={34} strokeWidth={1.2} />
              <h3>
                {searchData?.configured === false
                  ? "A world of stories, one connection away."
                  : source !== "all"
                    ? PUBLIC_SEARCH
                      ? "No guides from this source yet."
                      : "No indexed results from this source."
                    : "No trails found just yet."}
              </h3>
              <p>
                {searchData?.configured === false
                  ? "Connect a search provider to discover public travel pages and indexed social conversations."
                  : PUBLIC_SEARCH
                    ? "Try another destination, explore the field guide, or follow the broader search links for more stories."
                    : "Try another city or source. Private posts and pages that aren’t indexed won’t appear here."}
              </p>
              {searchData?.configured === false && (
                <button
                  className="primary-button"
                  onClick={() => setModal("connect")}
                >
                  Set up live search <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          )}
          </details>
        </section>

        <section className="bottom-banner">
          <div className="banner-illustration">
            <Compass size={52} strokeWidth={1} />
            <span className="dotted-path" />
            <span className="small-star">✳</span>
          </div>
          <div>
            <span className="section-eyebrow">
              A BETTER WAY TO FIND YOUR WAY
            </span>
            <h2>The internet is full of little secrets.</h2>
            <p>
              Travel stories, local tips, and conversations. One place to start
              exploring.
            </p>
          </div>
          <button onClick={() => setModal("how")}>
            Meet your new compass <ArrowUpRight size={17} />
          </button>
        </section>
      </main>

      <footer>
        <div className="footer-inner">
          <button className="brand footer-brand" onClick={() => goDiscover()}>
            <Compass size={21} strokeWidth={1.5} />
            elsewhere<span className="brand-dot">.</span>
          </button>
          <p>For the curious. For the detours. For a little more life.</p>
          <button onClick={() => setModal("about")}>
            A note on our sources <ArrowUpRight size={13} />
          </button>
          <span className="footer-credit">
            Made for wandering <Sun size={14} />
          </span>
        </div>
      </footer>

      {selectedPlace && (
        <Modal
          title={selectedPlace.name}
          onClose={() => setSelectedPlace(null)}
          className="place-modal"
        >
          <div className="modal-photo">
            <img
              src={assetUrl(selectedPlace.image)}
              alt={selectedPlace.imageAlt}
            />
            {selectedPlace.imageCredit ? (
              <a
                href={selectedPlace.imageCredit.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Photo: {selectedPlace.imageCredit.name} ·{" "}
                {selectedPlace.imageCredit.license}
              </a>
            ) : (
              <span>Illustrative photo</span>
            )}
          </div>
          <div className="modal-body">
            {selectedPlace.imageCredit && (
              <p className="photo-credit">
                <a
                  href={selectedPlace.imageCredit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {selectedPlace.imageCredit.name}
                </a>{" "}
                ·{" "}
                {selectedPlace.imageCredit.licenseUrl ? (
                  <a
                    href={selectedPlace.imageCredit.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selectedPlace.imageCredit.license}
                  </a>
                ) : (
                  selectedPlace.imageCredit.license
                )}
                . {selectedPlace.imageCredit.changes}
              </p>
            )}
            <span className="section-eyebrow">
              <MapPin size={12} />
              {selectedPlace.city}, {selectedPlace.region} ·{" "}
              {selectedPlace.category}
            </span>
            <h2>{selectedPlace.name}</h2>
            <p className="detail-description">{selectedPlace.description}</p>
            <div className="detail-tags">
              {selectedPlace.tags.map((tag) => (
                <span key={tag}>#{tag.replace(/\s/g, "")}</span>
              ))}
            </div>
            <div className="detail-actions">
              <button
                className="primary-button"
                onClick={() => savePlace(selectedPlace.id)}
              >
                <Bookmark
                  size={16}
                  fill={
                    savedIds.includes(selectedPlace.id)
                      ? "currentColor"
                      : "none"
                  }
                />
                {savedIds.includes(selectedPlace.id)
                  ? "Saved to your places"
                  : "Save for someday"}
              </button>
              <a
                className="secondary-button"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedPlace.name} ${selectedPlace.city}`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation size={16} />
                Find on map
                <ArrowUpRight size={14} />
              </a>
            </div>
            {selectedPlace.tip && (
              <div className="travel-tip">
                <Sun size={21} />
                <div>
                  <h4>A little before-you-go advice</h4>
                  <p>{selectedPlace.tip.text}</p>
                  <a
                    href={selectedPlace.tip.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selectedPlace.tip.sourceTitle}
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            )}
            <div className="detail-sources-heading">
              <h3>Follow the story</h3>
              <span>
                {selectedPlace.sources.length} original{" "}
                {selectedPlace.sources.length === 1 ? "source" : "sources"}
              </span>
            </div>
            <p className="detail-source-note">
              Summaries from published travel sources. Visit the original pages
              for more detail and any visitor reviews.
            </p>
            {selectedPlace.sources.map((item, index) => (
              <a
                className="detail-source"
                key={`${item.url}-${index}`}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={`source-avatar ${item.kind}`}>
                  {item.kind === "reddit" ? (
                    <MessageCircle size={19} />
                  ) : item.kind === "instagram" ? (
                    <Instagram size={19} />
                  ) : (
                    <Globe2 size={19} />
                  )}
                </span>
                <div>
                  <span>{item.publisher}</span>
                  <h4>{item.title}</h4>
                  <p>{item.excerpt}</p>
                </div>
                <ArrowUpRight size={18} />
              </a>
            ))}
            <button
              className="find-stories"
              onClick={() => {
                setSelectedPlace(null);
                search(
                  null,
                  `${selectedPlace.name} ${selectedPlace.city} reviews tips`,
                );
              }}
            >
              Find more stories & visitor tips
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}

      {modal === "how" && (
        <Modal title="How Elsewhere works" onClose={() => setModal(null)}>
          <div className="info-modal">
            <span className="modal-compass">
              <Compass size={31} />
            </span>
            <span className="section-eyebrow">
              A LITTLE CURIOSITY GOES A LONG WAY
            </span>
            <h2>
              Your next detour,
              <br />
              without the endless scroll.
            </h2>
            <div className="how-step">
              <span>01</span>
              <div>
                <h3>Start with a somewhere</h3>
                <p>
                  Search a city, a place, or a hashtag like #hiddenplacegokarna.
                  We turn it into a search for places and local stories.
                </p>
              </div>
            </div>
            <div className="how-step">
              <span>02</span>
              <div>
                <h3>Follow real sources</h3>
                <p>
                  {PUBLIC_SEARCH
                    ? "Start with places whose sources explicitly report fewer visitors. Each result shows the claim, its date, and uncertainty. General travel guides are available separately when you want wider context."
                    : "Browse our sourced field guide or use live search for travel pages and publicly indexed Reddit and Instagram posts. Every result links back to its source."}
                </p>
              </div>
            </div>
            <div className="how-step">
              <span>03</span>
              <div>
                <h3>Make a little someday list</h3>
                <p>
                  Bookmark your favourites, read visitor advice at the original
                  source, and open the location on a map. Your saved places stay
                  in this browser.
                </p>
              </div>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setModal(null);
                document.getElementById("destination")?.focus();
              }}
            >
              Let’s get a little lost
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}

      {modal === "about" && (
        <Modal title="A note on our sources" onClose={() => setModal(null)}>
          <div className="info-modal">
            <span className="modal-compass">
              <Globe2 size={30} />
            </span>
            <h2>
              Good discoveries
              <br />
              start with good sources.
            </h2>
            <p>
              Our field guide contains hand-selected places with links to
              published tourism and travel pages. Descriptions and tips are
              summaries. Destination photographs have linked credits; other
              images are labelled as illustrative scenery in the place details.
            </p>
            <p>
              {PUBLIC_SEARCH
                ? "The India index combines tourism listings, explicit crowd comparisons, community guides, and available OpenStreetMap data. Quieter recommendations require visitor-related evidence. Refreshes are scheduled every six hours, with publication dates and collection gaps shown. These reports are not live headcounts. Traveller discussions open their original threads."
                : "Live search uses a configured search provider. It can surface public travel pages and indexed social conversations, but cannot cover every page or private post."}
            </p>
            <p>
              We don’t invent reviews, ratings, or visitor counts. Search
              excerpts may contain opinions; open the original source to see the
              full context and check current access before travelling.
            </p>
            <div className="source-status">
              <span
                className={
                  health?.search?.configured
                    ? "status-dot connected"
                    : "status-dot"
                }
              />
              {PUBLIC_SEARCH
                ? "Public travel-guide search · No account or API key needed"
                : health?.search?.configured
                  ? "Live web search is connected"
                  : "Sourced field guide available · Live search needs a connection"}
            </div>
            <button className="primary-button" onClick={() => setModal(null)}>
              Keep exploring
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}

      {!PUBLIC_SEARCH && modal === "connect" && (
        <Modal title="Connect live search" onClose={() => setModal(null)}>
          <div className="info-modal">
            <span className="modal-compass">
              <Globe2 size={30} />
            </span>
            <span className="section-eyebrow">BRING THE WIDER WEB ALONG</span>
            <h2>
              Connect your
              <br />
              discovery engine.
            </h2>
            <p>
              The field guide works right away. For live results, the person
              running this site needs to configure one search provider on the
              server.
            </p>
            <ol className="setup-steps">
              <li>
                Copy <code>.env.example</code> to <code>.env</code> in the
                project.
              </li>
              <li>
                Add a{" "}
                <a
                  href="https://app.tavily.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tavily API key <ExternalLink size={12} />
                </a>{" "}
                as <code>TAVILY_API_KEY</code>, or set <code>SEARXNG_URL</code>{" "}
                to your own SearXNG server.
              </li>
              <li>
                Restart the app and search again. The README includes both setup
                options.
              </li>
            </ol>
            <p className="setup-note">
              Keys stay on the server. Once connected, searches can include
              public travel sites and indexed social conversations.
            </p>
            <button className="primary-button" onClick={() => setModal(null)}>
              Back to exploring
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

import './styles.css';
