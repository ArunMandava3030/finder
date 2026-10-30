"""Optional keyless search adapter; performs no searches until POST /search."""

from __future__ import annotations

import asyncio
import html
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Callable, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ddgs import DDGS
from ddgs.exceptions import DDGSException, RatelimitException, TimeoutException
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

UPSTREAM_TIMEOUT_SECONDS = 10
REQUEST_TIMEOUT_SECONDS = 12
MAX_CONCURRENT_SEARCHES = 2
COVERAGE_WARNING = (
    "These are publicly indexed search excerpts, not verified reviews or live "
    "comment threads. Open the original source for context."
)
FRESHNESS_WARNING = (
    "The requested freshness is a search-engine filter, not a verified publication "
    "date. Publication dates are unavailable for these excerpts."
)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    query: str = Field(min_length=2, max_length=160)
    max_results: int = Field(default=8, ge=1, le=8)
    source: Literal["all", "web", "reddit"] = "all"
    freshness: Literal["month", "year", "any"] = "any"

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2 or not any(character.isalnum() for character in value):
            raise ValueError("Enter a place or travel query.")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Control characters are not allowed.")
        return value


class SearchItem(BaseModel):
    title: str
    url: str
    text: str
    publishedAt: None = None
    source: Literal["web", "reddit"]
    type: Literal["search_excerpt"] = "search_excerpt"
    isReview: Literal[False] = False
    retrievedAt: str


class SearchResponse(BaseModel):
    items: list[SearchItem]
    warnings: list[str]


def plain_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    value = html.unescape(re.sub(r"<[^>]*>", " ", value))
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    return re.sub(r"\s+", " ", value).strip()[:limit]


def safe_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 2048:
        return None
    value = value.strip()
    if re.search(r"[\x00-\x20\x7f]", value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        # Accessing port also validates malformed or out-of-range port values.
        _ = parsed.port
        query = [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in ("fbclid", "gclid")
        ]
        return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path or "/", urlencode(query), ""))
    except ValueError:
        return None


def result_source(url: str) -> Literal["web", "reddit"]:
    hostname = urlsplit(url).hostname or ""
    return "reddit" if hostname in ("reddit.com", "redd.it") or hostname.endswith(".reddit.com") else "web"


def normalize_results(rows: object, payload: SearchRequest) -> list[SearchItem]:
    if not isinstance(rows, list):
        raise ValueError("Unexpected upstream response.")
    retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    seen: set[str] = set()
    items: list[SearchItem] = []
    for row in rows[:40]:
        if not isinstance(row, dict):
            continue
        url = safe_url(row.get("href") or row.get("url"))
        title = plain_text(row.get("title"), 240)
        if not url or not title or url in seen:
            continue
        source = result_source(url)
        if payload.source != "all" and source != payload.source:
            continue
        seen.add(url)
        items.append(SearchItem(
            title=title,
            url=url,
            text=plain_text(row.get("body") or row.get("text"), 1200),
            source=source,
            retrievedAt=retrieved_at,
        ))
        if len(items) >= payload.max_results:
            break
    return items


def run_search(payload: SearchRequest) -> list[dict]:
    # DDGS otherwise reads this variable implicitly. This adapter offers no proxy mode.
    if os.environ.get("DDGS_PROXY"):
        raise RuntimeError("Proxy configuration is unsupported.")
    query = payload.query
    if payload.source == "reddit":
        query += " site:reddit.com"
    elif payload.source == "web":
        query += " -site:reddit.com -site:redd.it"
    options = {
        "region": "in-en",
        "safesearch": "moderate",
        "max_results": payload.max_results,
        "backend": "duckduckgo,bing",
    }
    if payload.freshness != "any":
        options["timelimit"] = {"month": "m", "year": "y"}[payload.freshness]
    with DDGS(timeout=UPSTREAM_TIMEOUT_SECONDS, verify=True) as search:
        return search.text(query, **options)


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"items": [], "warnings": [], "error": {"code": code, "message": message}},
        headers={"Cache-Control": "no-store", **({"Retry-After": "2"} if status == 503 else {})},
    )


def create_app(
    search_function: Callable[[SearchRequest], object] = run_search,
    *,
    request_timeout: float = REQUEST_TIMEOUT_SECONDS,
) -> FastAPI:
    executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_SEARCHES, thread_name_prefix="search-adapter")
    capacity = threading.BoundedSemaphore(MAX_CONCURRENT_SEARCHES)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="Elsewhere Search Adapter", version="1.0.0", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError):
        return error_response(400, "INVALID_REQUEST", "Use a 2–160 character query, 1–8 results, and supported source/freshness values.")

    @app.get("/health")
    async def health():
        # Liveness only: this endpoint never contacts a search engine.
        return {"ok": True, "provider": "ddgs", "region": "in-en", "maxConcurrentSearches": MAX_CONCURRENT_SEARCHES}

    @app.post("/search", response_model=SearchResponse)
    async def search(payload: SearchRequest):
        if not capacity.acquire(blocking=False):
            return error_response(503, "SEARCH_BUSY", "Search is busy. Please try again shortly.")
        try:
            future = executor.submit(search_function, payload)
        except RuntimeError:
            capacity.release()
            return error_response(503, "SEARCH_UNAVAILABLE", "Search is temporarily unavailable.")
        # Keep the slot until the worker really exits, even if HTTP times out or disconnects.
        future.add_done_callback(lambda _future: capacity.release())
        try:
            async_future = asyncio.wrap_future(future)
            async_future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            rows = await asyncio.wait_for(asyncio.shield(async_future), timeout=request_timeout)
            items = normalize_results(rows, payload)
        except (asyncio.TimeoutError, TimeoutException):
            return error_response(504, "SEARCH_TIMEOUT", "The search engine took too long. Please try again later.")
        except RatelimitException:
            return error_response(503, "PROVIDER_RATE_LIMITED", "The search engine is limiting requests. Please try again later.")
        except Exception:
            return error_response(502, "PROVIDER_UNAVAILABLE", "The search engine could not complete this request.")
        warnings = [COVERAGE_WARNING]
        if payload.freshness != "any":
            warnings.append(FRESHNESS_WARNING)
        if not items:
            warnings.append("No indexed results matched this query and source filter.")
        return JSONResponse(content=SearchResponse(items=items, warnings=warnings).model_dump(), headers={"Cache-Control": "no-store"})

    return app


app = create_app()
