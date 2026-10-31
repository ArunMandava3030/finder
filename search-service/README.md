# Keyless collection and optional search adapter

This Python component collects configured public HTML place listings with Scrapling and runs explicit search batches for a static GitHub Pages snapshot. Nothing is collected until a command is invoked or an optional HTTP request arrives. No API key is required. It does not retrieve Reddit comment threads or claim to supply verified reviews.

## Scrapling place collection

The pinned `scrapling==0.5` dependency provides its parser engine. Ordinary HTTP fetching, robot-rule checks, response-size limits, and deadlines are handled by `scrape_places.py`, then Scrapling's `Selector` extracts the configured listing fields. This does not install or invoke browser fetchers, stealth features, proxy rotation, or challenge solvers.

From the repository root, after installing `search-service/requirements.txt` into a virtual environment:

```text
python search-service/scrape_places.py --sources data/scrapling-sources.json --destinations data/india-destinations.json --output .local/scraped-places.json
npm run data:refresh -- --destinations none --scraped .local/scraped-places.json
```

The manifest specifies nine source URLs, destinations, and extraction rules: eight place-listing/detail pages and the `gokarna-crowd-guide` comparison. Use `--only` with comma-separated source IDs to collect a subset. The output is an intermediate collection file; Node validates and merges it into the published India index, retaining source attribution and dates. Failed sources must not erase earlier observations or make them look newly collected.

The `crowd_table` parser reads [Karnataka Tourism's Gokarna beach guide](https://karnatakatourism.org/en/blogs/gokarna-beaches/), locates a single table with `Beach` and `Crowd Level` headers, and validates row alignment and recognized levels. Table/row/place limits bound extraction; ambiguous tables, merged cells, and malformed rows cannot supply crowd evidence. Belekan is excluded because its crowd cell is blank even though another cell says “Very Low.” The current eight valid rows yield five quieter, two busy, and one mixed classification. Nirvana, God's Own, and Small Hell are `very_low`; Half Moon and Paradise are `low`.

Each accepted row exports `crowdEvidence` with its original URL, publisher, level, direction, and retrieval timestamp. The visible June 2026 article date is preserved as `publishedPeriod: "2026-06"`; an exact publication day remains unknown. Refreshing that page does not turn its general comparison into a new visitor observation. These are official source claims with limited corroboration, not live headcounts, verified visitor reviews, or copied firsthand comments.

The downstream ranker orders `very_low` before `low` and the primary interface shows only `quieter` assessments. Unknown, mixed, and busy places are excluded; conflicting, conditional, historical, or stale evidence is treated as mixed. A “hidden” label, quiet atmosphere, coordinates, or missing reviews cannot qualify a place. Empty evidence coverage remains explicit, and general guides are separately collapsed with crowd levels unverified.

GitHub Actions runs this command for all nine sources every six hours or on manual refresh, with a five-minute step limit; code pushes deploy without another upstream collection. GitHub Pages serves the resulting JSON and frontend; it hosts no Python process. The scheduled runner uses Python 3.13, and parser imports and CSS/XPath extraction also passed locally on Python 3.14.3. No `scrapling install` command or browser download is needed for this parser-only integration. See [Scrapling's installation guide](https://scrapling.readthedocs.io/en/latest/#installation) and [Selector API](https://scrapling.readthedocs.io/en/latest/api-reference/selector.html).

## Discussion search batches

From this directory, install dependencies in a virtual environment:

```text
python -m pip install -r requirements.txt
python search_batch.py --input queries.json --output results.json
```

Input:

```json
{
  "queries": [
    { "id": "gokarna-reddit", "query": "Gokarna travel", "source": "reddit", "freshness": "year" }
  ],
  "max_results": 6
}
```

The output contains `validationVersion: 2`, `relevanceChecked: true`, `generatedAt`, and ordered `results`, each with `id`, `status` (`ok`, `empty`, or `error`), `items`, and `warnings`. Errors additionally contain a sanitized `error` object. A completed batch exits with `0` if any query succeeded or returned an empty result, `1` if every query failed, or `2` for invalid input/output. Up to 100 queries and eight results per query are allowed. The batch runs one query at a time, with a one-second gap between queries. There are no automatic retries or proxy options.

Static Reddit entries retain only genuine `/r/.../comments/...` discussion URLs on recognized Reddit hosts and a neutral label; business pages, subreddit roots, user-written titles, and excerpts are discarded. Publication dates remain `null`. Requested freshness is an upstream filter, not proof of a post's publication date. A destination-term check removes clearly irrelevant search results before export. Coverage and engine availability can vary; empty or unavailable sources must remain explicit. Static ingestion requires the current validation metadata so older, unchecked batches are rejected.

The optional HTTP interface is available with `uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1`. `GET /health` does not make upstream requests. `POST /search` accepts `query`, `max_results`, `source` (`all`, `web`, `reddit`), and `freshness` (`any`, `month`, `year`). HTTP mode returns search excerpts, while the batch exporter removes Reddit text. GitHub Pages does not host this Python process; run batches only during refresh jobs.

To test:

```text
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Implementation references: [DDGS](https://github.com/deedy5/ddgs), [Reddit API access requirements](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), and [Reddit developer access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data). Direct Reddit API access requires approval and authentication; this adapter does not call that API.
