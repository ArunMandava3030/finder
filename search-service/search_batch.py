"""Run an explicit, bounded search batch for a periodically generated static site."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import sleep
from typing import Callable
from urllib.parse import unquote, urlsplit

from ddgs.exceptions import RatelimitException, TimeoutException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app import COVERAGE_WARNING, FRESHNESS_WARNING, SearchRequest, normalize_results, plain_text, run_search

GENERIC_QUERY_WORDS = frozenset({
    "a", "an", "and", "or", "the", "in", "near", "to", "of", "for", "with",
    "india", "indian", "travel", "traveller", "travellers", "traveler", "travelers",
    "trip", "trips", "tips", "review", "reviews", "itinerary", "itineraries",
    "hidden", "secret", "places", "place", "spots", "things", "do", "tourism",
    "guide", "guides", "best", "offbeat", "visit", "visiting", "reddit", "discussion",
    "discussions", "recent", "latest", "recommendation", "recommendations",
    "beach", "beaches", "waterfall", "waterfalls", "trek", "trekking", "local",
    "experience", "experiences",
})


def is_reddit_thread(url: str) -> bool:
    """Keep public discussion links, excluding business pages and subreddit roots."""
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme in {"http", "https"}
            and parsed.hostname in {"reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com"}
            and not parsed.username and not parsed.password
            and bool(re.match(r"^/r/[A-Za-z0-9_]+/comments/[A-Za-z0-9]+(?:/|$)", parsed.path))
        )
    except ValueError:
        return False


def relevant_to_query(row: object, query: str) -> bool:
    """Require a destination-specific word before preserving a search-engine hit."""
    if not isinstance(row, dict):
        return False
    query_words = {word for word in re.findall(r"\w+", query.casefold()) if len(word) >= 3}
    anchors = query_words - GENERIC_QUERY_WORDS
    if not anchors:
        return True
    content = " ".join((
        plain_text(row.get("title"), 1000), plain_text(row.get("body") or row.get("text"), 3000),
        unquote(str(row.get("href") or row.get("url") or "")),
    ))
    words = set(re.findall(r"\w+", content.casefold()))
    return bool(anchors.intersection(words))


class BatchQuery(SearchRequest):
    id: str = Field(min_length=1, max_length=100)


class SearchBatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    queries: list[BatchQuery] = Field(min_length=1, max_length=100)
    max_results: int = Field(default=6, ge=1, le=8)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({query.id for query in self.queries}) != len(self.queries):
            raise ValueError("Batch query IDs must be unique.")
        return self


def run_batch(batch: SearchBatch, search_function: Callable = run_search, pause: Callable = sleep) -> dict:
    def execute(query: BatchQuery) -> dict:
        payload = SearchRequest(
            query=query.query,
            max_results=batch.max_results,
            source=query.source,
            freshness=query.freshness,
        )
        try:
            rows = search_function(payload)
            if not isinstance(rows, list):
                raise ValueError("Unexpected upstream response.")
            relevant_rows = [row for row in rows[:40] if relevant_to_query(row, payload.query)]
            items = [item.model_dump() for item in normalize_results(relevant_rows, payload)]
            items = [item for item in items if item["source"] != "reddit" or is_reddit_thread(item["url"])]
        except TimeoutException:
            return {"id": query.id, "status": "error", "items": [], "warnings": [], "error": {"code": "SEARCH_TIMEOUT", "message": "The search engine took too long."}}
        except RatelimitException:
            return {"id": query.id, "status": "error", "items": [], "warnings": [], "error": {"code": "PROVIDER_RATE_LIMITED", "message": "The search engine is limiting requests."}}
        except Exception:
            return {"id": query.id, "status": "error", "items": [], "warnings": [], "error": {"code": "PROVIDER_UNAVAILABLE", "message": "The search engine could not complete this query."}}
        warnings = [COVERAGE_WARNING]
        if query.freshness != "any":
            warnings.append(FRESHNESS_WARNING)
        for item in items:
            if item["source"] == "reddit":
                # Static exports retain a link, not copies of user titles/comments.
                item["title"] = "Traveller discussion on Reddit"
                item["text"] = ""
        if any(item["source"] == "reddit" for item in items):
            warnings.append("Reddit entries are external discussion links; user-written titles and text are not stored.")
        if not items:
            warnings.append("No indexed results matched this query and source filter.")
        return {"id": query.id, "status": "ok" if items else "empty", "items": items, "warnings": warnings}

    results = []
    for index, query in enumerate(batch.queries):
        if index:
            pause(1)
        results.append(execute(query))
    return {
        "validationVersion": 2, "relevanceChecked": True,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSON batch input path")
    parser.add_argument("--output", required=True, type=Path, help="JSON result output path")
    arguments = parser.parse_args()
    try:
        if arguments.input.stat().st_size > 256 * 1024:
            raise ValueError("Batch input is too large.")
        batch = SearchBatch.model_validate_json(arguments.input.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, ValidationError):
        print("Invalid batch input. Use up to 100 unique IDs and validated search parameters.", file=sys.stderr)
        return 2
    output = run_batch(batch)
    try:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        print("Could not write the batch output file.", file=sys.stderr)
        return 2
    succeeded = sum(result["status"] != "error" for result in output["results"])
    print(f"Completed {len(output['results'])} queries; {succeeded} completed without provider errors.")
    # Partial batches are useful; an all-error batch fails clearly for scheduled jobs.
    return 0 if succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
