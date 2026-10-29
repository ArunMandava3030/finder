# Elsewhere

A place-discovery website for finding quieter corners of a city. Search `hidden places in Gokarna` or `#hiddenplacegokarna`, explore source-linked travel guides, and save places for later.

The default website runs entirely in the browser and on GitHub Pages. **No API key or backend is required.** It combines a curated field guide with live Wikipedia and Wikivoyage searches. Links to broader web and social searches open those services separately; they do not import their results, reviews, or comments into Elsewhere.

GitHub Pages deployment target: [ArunMandava3030.github.io/finder](https://ArunMandava3030.github.io/finder/).

## Run locally

Install Node.js 22.12 or later, then run:

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). This starts the Vite frontend in public search mode. You do not need an `.env` file for the default setup.

To preview a production build:

```powershell
npm run build
npm run preview
```

Open [http://localhost:4173](http://localhost:4173). Public guide searches work in this static preview too.

## What search includes

- **Field guide:** curated places, published reference links, attributed destination photographs, and clearly identified illustrative scenery.
- **Public guides:** live Wikipedia and Wikivoyage results retrieved through their public MediaWiki APIs, with links to the original articles.
- **Broader discovery:** external searches for web pages, Reddit discussions, and Instagram pages. These links navigate to another service's results; Elsewhere does not retrieve or summarize those reviews.
- **Saved places:** browser `localStorage` bookmarks, with no account, database, or cross-device sync.

Guide search sends your query directly to Wikimedia services. These requests use MediaWiki's documented [unauthenticated cross-origin API access](https://www.mediawiki.org/wiki/API:Cross-site_requests). Public API availability, coverage, and rate limits can affect results. Curated places remain separate from fetched guides, and the interface reports empty results or failures.

The website does not crawl the whole internet, scrape Instagram or Reddit automatically, access private posts, or invent ratings and visitor reviews. Open the original articles or external search results for full context and current visitor advice.

## GitHub Pages deployment

The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs on pushes to `main` and can also be started from the Actions tab. It installs dependencies, runs the unit tests, builds the static frontend, and deploys the `dist` artifact to GitHub Pages.

In the repository, set **Settings → Pages → Build and deployment → Source → GitHub Actions**. No custom GitHub secret is required. The workflow provides:

```dotenv
VITE_SEARCH_MODE=public
VITE_BASE_PATH=/finder/
```

The base path keeps scripts, styles, images, and the favicon under `/finder/`. For a renamed repository or a custom domain, update `VITE_BASE_PATH` in the workflow to match its deployment path. See the [official Vite Pages guide](https://vite.dev/guide/static-deploy.html#github-pages).

To reproduce the Pages build locally:

```powershell
npm run build:pages
npm run preview -- --base=/finder/
```

Open [http://localhost:4173/finder/](http://localhost:4173/finder/). `build:pages` selects public search mode and the `/finder/` base path without changing your terminal environment. GitHub Pages serves the frontend only and does not run the optional Express API.

## Optional server search

For a separate full server deployment, the repository also contains an Express integration for a self-hosted [SearXNG](https://github.com/searxng/searxng) metasearch service. This optional mode is independent of the default GitHub Pages site.

Copy `.env.example` to `.env` once, or edit an existing `.env` without overwriting it:

```powershell
Copy-Item .env.example .env
```

Set:

```dotenv
VITE_SEARCH_MODE=server
VITE_BASE_PATH=/
SEARXNG_URL=http://localhost:8080
TAVILY_API_KEY=
PORT=3001
```

Start your own SearXNG instance. An optional local Docker configuration is included; with Docker Desktop running in Linux container mode:

```powershell
$env:SEARXNG_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up -d
npm run dev:server
```

The generated secret stays in the terminal environment. Generate it again before using Compose in a new terminal, or store it as `SEARXNG_SECRET` in your untracked `.env`. No secret is included in the repository.

Open [http://localhost:5173](http://localhost:5173). In this mode, Vite forwards `/api` requests to Express on port 3001. Restart after changing environment variables. Keep `PORT=3001` during development or update the Vite proxy target to match.

The included SearXNG service binds to `127.0.0.1:8080` and enables JSON responses. Check it with:

```powershell
Invoke-RestMethod 'http://localhost:8080/search?q=Gokarna&format=json'
docker compose logs --tail 100 searxng
```

Use `docker compose restart searxng` after configuration changes and `docker compose down` to stop it. This configuration is for local use; its public-instance limiter is disabled. Your instance still depends on upstream search engines and can encounter blocks, CAPTCHAs, or rate limits. Existing instances must enable `json` in `search.formats`; see the [SearXNG API documentation](https://docs.searxng.org/dev/search_api.html).

The optional backend also supports `TAVILY_API_KEY` for an existing Tavily account. A nonempty key takes precedence over SearXNG; neither this key nor that service is needed for the public website. Keep all secrets in server environment variables, never in a `VITE_` variable. The integration references are [SearXNG's official repository](https://github.com/searxng/searxng) and [Tavily's official JavaScript repository](https://github.com/tavily-ai/tavily-js).

To run a built server-mode site after setting the environment above:

```powershell
npm run build:server
npm start
```

Express serves the built frontend and API at [http://localhost:3001](http://localhost:3001). A public server deployment needs its own hosting; this mode cannot run on GitHub Pages. The server includes per-process caching and rate limits; a shared deployment should provide authentication and shared limits appropriate to its upstream service.

The optional API exposes `GET /api/health` and `GET /api/search?q=Gokarna&source=all`. Valid source filters are `all`, `web`, `reddit`, and `instagram`; queries are 2–160 characters. Results link to publicly indexed pages and may include source excerpts. They do not represent complete comment threads or exhaustive reviews. A missing provider returns `503 SEARCH_NOT_CONFIGURED`, invalid input returns `400`, rate limits return `429`, and upstream failure or timeout returns `502` or `504`.

## Sources and attribution

Live guide excerpts come from Wikipedia and Wikivoyage contributors. Each result links to the source article, whose history identifies contributors and whose page provides the applicable license. Wikivoyage text is available under [CC BY-SA 4.0](https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft); Wikipedia reuse terms are described in the [Wikimedia Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content). Keep article attribution and applicable license notices when reusing that text.

Destination photographs have individual source and license credits in the place details. Other scenery is identified as illustrative. These text and image licenses apply to the respective source material, not automatically to unrelated project code.

## Checks

```powershell
npm test
npm run build:pages
npm run test:pages
```

This checks the default public website. To check the optional server-mode interface separately:

```powershell
npm run build:server
npm run test:ui
```

Each browser suite needs its corresponding build: `test:pages` uses the public Pages build, while `test:ui` uses the server build. Browser tests use controlled responses to check interactions without paid API calls. They exercise desktop and mobile layouts, bookmarks, filters, source links, and search states. Preview screenshots are written to the ignored `.local/` directory.

The browser configuration uses project-local Chromium when available on Windows, otherwise installed Microsoft Edge. On other systems, run `npx playwright install chromium` first. If Edge automation is unavailable, install a separate test browser locally:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '.local/ms-playwright'
npx playwright install chromium
npm run build:pages
npm run test:pages
```

Public API requests and optional SearXNG connectivity also depend on the local network; perform a real search to check that connection.
