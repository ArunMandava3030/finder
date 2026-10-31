# Elsewhere

A place-discovery website for exploring quieter corners of Indian cities. Search `hidden places in Gokarna` or `#hiddenplacegokarna`, browse source-linked places and travel guides, and save places for later.

The website is hosted on **GitHub Pages with no API keys or paid backend**. A scheduled GitHub Actions job collects an India destination index and publishes it with the frontend. Visitors search that snapshot in the browser; optional Wikipedia and Wikivoyage searches provide additional public guides.

Live site: [ArunMandava3030.github.io/finder](https://ArunMandava3030.github.io/finder/).

## Run locally

Install Node.js 22.12 or later:

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The repository includes a source-linked snapshot, so Python, an API key, and an `.env` file are unnecessary for browsing or frontend development.

Preview the GitHub Pages build:

```powershell
npm run build:pages
npm run preview -- --base=/finder/
```

Open [http://localhost:4173/finder/](http://localhost:4173/finder/). For a site hosted at the domain root instead, use `npm run build` and `npm run preview`.

## Data and search

| Source | What Elsewhere uses | Limits |
| --- | --- | --- |
| OpenStreetMap through Overpass | Named points of interest, categories, coordinates, source links | Mapped coverage varies; shared APIs can be unavailable or rate limited. |
| Wikivoyage | Destination listings, descriptions, coordinates where available, and source attribution | Community guide descriptions are not individual visitor reviews. |
| Configured public HTML pages through Scrapling | Place listings extracted using source-specific CSS selectors | Covers only the configured sources; blocked pages and changed markup can prevent collection. |
| DDGS search indexes | Destination-relevant links to publicly indexed Reddit discussion threads | Results can be empty, blocked, incomplete, or stale. No Reddit comment threads are fetched. |
| Wikipedia and Wikivoyage browser search | Additional public guide results with original article links | Requires access to Wikimedia APIs when the visitor searches. |
| Curated field guide | Selected places and attributed destination photos or clearly marked illustrative scenery | Editorial starting points, separate from collected source coverage. |

The scheduled collector combines source records, keeps their URLs and collection dates, and writes `public/data/india-index.json`. It processes destinations serially and bounds upstream requests. The browser reads this published file; GitHub Pages does not run a Python or Express server.

HTML collection uses [Scrapling 0.5](https://pypi.org/project/scrapling/0.5/) to parse pages listed in `data/scrapling-sources.json`. The initial registry covers eight official tourism and district pages for Gokarna, Coorg, Wayanad, Munnar, and Dehradun. A small ordinary HTTP fetcher checks robots rules and bounds request time and response size before passing HTML to Scrapling's `Selector`. This uses the parser-only package: no browser download, browser impersonation, stealth fetcher, proxy rotation, or challenge solving is enabled. Source pages and their attribution remain attached to extracted places. Scrapling extracts configured pages; it does not search or crawl the entire web.

Discussion collection uses Indian-region search and a requested year filter. It checks for destination words and genuine Reddit thread URLs before exporting a neutral label and link. User-written Reddit titles, excerpts, comments, author details, and ratings are discarded. A search engine's freshness filter does not establish a post's publication date, so unknown publication dates remain unknown.

The initial snapshot also includes a small set of manually checked public discussion links, marked `collectionMethod: manual_search`. These keep their original discovery timestamps and any publication dates established from the source; a known calendar date is stored without inventing a publication time. They are starting links, not permanent seeds: a successful later discussion search can replace them, while search failures retain them with an earlier-collection label.

**Discovery fit is a rule-based estimate, not proof that a place is hidden, safe, underrated, or worth visiting.** It uses available descriptions, location/category signals, and source corroboration. Missing reviews or low web coverage do not prove that a place is undiscovered. The interface exposes source links, collection status, and the reasons behind its estimate.

No verified visitor ratings or direct reviews are supplied. Broader web, Reddit, and Instagram search links open those services separately; their results and reviews are not automatically imported. Direct Reddit API access requires [approval and authentication](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki). Private posts and content behind access controls are outside the collector's coverage.

Saved places use browser `localStorage`; there is no account or cross-device sync. Additional guide searches send the query directly to Wikimedia using its documented [public cross-origin API access](https://www.mediawiki.org/wiki/API:Cross-site_requests).

## Refresh and deployment

[The Pages workflow](.github/workflows/deploy-pages.yml) runs on pushes to `main`, manual dispatch, and a schedule of **00:17, 06:17, 12:17, and 18:17 UTC**. GitHub schedules are best effort and can be delayed; public repository schedules can be disabled after inactivity. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Each run:

1. Installs Node/Python dependencies and runs the unit tests.
2. Attempts to restore a newer last-published index from this project's fixed Pages URL, with size, schema, date, and link validation. If it cannot, it keeps the repository snapshot.
3. On scheduled or manual runs, prepares destination queries, checks public search indexes, extracts configured HTML listings with Scrapling, and refreshes OpenStreetMap/Wikivoyage records.
4. Retains previous records when providers fail, keeping their source timestamps and reporting unavailable or stale coverage.
5. Builds the static site and deploys its artifact to GitHub Pages.

A scheduled refresh is not a guarantee of new places or new discussion links. The index generation time describes a build; individual source timestamps describe when data was collected. A failed provider must not make older records look newly retrieved. Empty or failed discussion searches retain earlier link-only observations for up to 30 days, marked stale; a successful non-empty search replaces that destination's links. Generated updates are published in the Pages artifact, not automatically committed to Git.

Upstream collection runs on the six-hour schedule and manual dispatch. Code pushes test and deploy the latest available snapshot without making another round of requests to shared data services.

In the repository, set **Settings → Pages → Build and deployment → Source → GitHub Actions**. No custom GitHub secrets are needed. The workflow sets `VITE_SEARCH_MODE=public` and `VITE_BASE_PATH=/finder/`. The build has a 30-minute limit, including up to five minutes for HTML collection and fifteen for the place-source refresh. Dependency/build/test failures stop deployment. Collection failures allow a valid previous snapshot to remain available.

The workflow uses official GitHub actions pinned to commit SHAs. The path keeps scripts, styles, images, and the favicon under `/finder/`; update it if the repository name changes. See the [Vite Pages guide](https://vite.dev/guide/static-deploy.html#github-pages).

To refresh data locally, install Python 3.13 and use a virtual environment:

```powershell
python -m venv .local/search-venv
& ./.local/search-venv/Scripts/python.exe -m pip install -r search-service/requirements-dev.txt
npm run data:queries
& ./.local/search-venv/Scripts/python.exe search-service/search_batch.py --input .local/discussion-queries.json --output .local/discussion-results.json
& ./.local/search-venv/Scripts/python.exe search-service/scrape_places.py --sources data/scrapling-sources.json --destinations data/india-destinations.json --output .local/scraped-places.json
npm run data:refresh -- --evidence .local/discussion-results.json --scraped .local/scraped-places.json
```

On macOS/Linux, the virtual environment's executable is `.local/search-venv/bin/python`. To collect only place sources, run `npm run data:refresh`. To limit place collection, use `npm run data:refresh -- --destinations gokarna,hampi`. To merge a validated discussion batch into the existing index without collecting places, pass `--destinations none --evidence .local/discussion-results.json`.

For just the configured HTML sources, run the Scrapling command above and then `npm run data:refresh -- --destinations none --scraped .local/scraped-places.json`. Its `--only` option accepts comma-separated source IDs from the manifest. Scheduled jobs merge a collector output only when the file exists; provider failures keep earlier data with its original dates. The scheduled environment uses Python 3.13, and the parser integration has also been checked on Python 3.14.

The collector does not use paid search keys, proxy rotation, CAPTCHA workarounds, or automatic retries. Its dependencies and source adapters are based on [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling), [deedy5/ddgs](https://github.com/deedy5/ddgs), the [Overpass API](https://github.com/drolbr/Overpass-API), and the [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page). DDGS is an unofficial search-index client and depends on upstream availability. The [search component README](search-service/README.md) documents its bounded collectors and optional local HTTP interface.

## Sources and attribution

OpenStreetMap data is attributed to OpenStreetMap contributors and available under the [Open Database License](https://www.openstreetmap.org/copyright). Preserve attribution and applicable database share-alike obligations when redistributing it.

Wikivoyage text comes from its contributors under [CC BY-SA 4.0](https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft). Source article links identify the original context and provide access to contributor histories; collected excerpts carry source and license references. Additional Wikipedia excerpts follow the applicable [Wikimedia reuse terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content). Retain article attribution and applicable license notices when reusing or adapting source text.

Official tourism pages contribute factual place names and source links. Their prose, photographs, ratings, and reviews are not copied; their own terms continue to apply. The generated description directs visitors to the original publisher. Listing publication dates and access conditions remain unknown unless the source explicitly supplies them.

Destination photographs have their own source and license credits in place details. Other scenery is identified as illustrative. Source text, data, and image licenses apply to those materials, not automatically to unrelated project code.

## Checks

```powershell
npm test
npm run build:pages
npm run test:pages
```

Run the Python tests from `search-service` so its modules are on the import path:

```powershell
Push-Location search-service
& ../.local/search-venv/Scripts/python.exe -m unittest discover -s tests -v
Pop-Location
```

The Node suite covers data normalization, ranking, source failures, and snapshot restoration. Python tests use controlled search responses for query bounds, relevance, thread links, text removal, pacing, and error handling. Browser tests exercise public search, filters, saved places, source links, and desktop/mobile layouts with controlled responses.

Browser tests need the corresponding frontend build. On Linux/macOS, install Chromium first with `npx playwright install chromium`. On Windows the configuration uses a project-local Chromium installation when available, otherwise Microsoft Edge:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '.local/ms-playwright'
npx playwright install chromium
npm run build:pages
npm run test:pages
```

Screenshots and local collector outputs stay in ignored `.local/`. Offline tests do not prove that a public search engine or community API is currently reachable.

## Optional full server mode

The repository also retains an Express search integration for separate local or server deployments. It is not used by the GitHub Pages site or scheduled data refresh.

Copy `.env.example` to `.env` only if no local file already exists. Set `VITE_SEARCH_MODE=server`, `VITE_BASE_PATH=/`, `PORT=3001`, and `SEARXNG_URL=http://localhost:8080`. A self-hosted [SearXNG](https://github.com/searxng/searxng) instance must enable JSON output; see its [search API documentation](https://docs.searxng.org/dev/search_api.html).

The included local Docker Compose setup requires a generated secret:

```powershell
$env:SEARXNG_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up -d
npm run dev:server
```

SearXNG binds to `127.0.0.1:8080`. Its local limiter is disabled, and upstream engines can still block or rate-limit requests. Use `docker compose down` to stop it. Generate the secret again for a new terminal or keep it in your untracked `.env`.

This optional API also accepts an existing `TAVILY_API_KEY`, which takes precedence over SearXNG. It is unnecessary for the selected Pages architecture. Secrets belong only in server environment variables, never `VITE_` values.

For the server build and its separate browser suite:

```powershell
npm run build:server
npm run test:ui
npm start
```

Express serves the frontend and API at [http://localhost:3001](http://localhost:3001). The server exposes `GET /api/health` and `GET /api/search?q=Gokarna&source=all`. It needs a separate runtime if publicly deployed; GitHub Pages hosts static files only.

The collection engine also exposes `GET /api/destinations`, `GET /api/discover?q=Gokarna`, and `GET /api/evidence?q=Half%20Moon%20Beach%20Gokarna`. Discovery combines bounded source requests, deduplicates places, and caches observations on disk. Failed sources retain their original dates; successful sources replace obsolete records. API requests share a rate limit and have deadlines and concurrency limits.

For optional live evidence, `DDGS_URL` points to the local Python service described in its README. Direct Reddit access additionally needs an approved app and the server-only `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` variables. Discussion content stays in a short-lived memory cache and is never included in static exports. These optional services are not required or deployed for Pages.
