# Optional keyless search adapter

This Python component supports explicit search batches for a static GitHub Pages snapshot. It performs no searches until a batch is invoked or a request arrives. No API key is required. It queries public search indexes; it does not retrieve Reddit comment threads or claim to supply verified reviews.

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
