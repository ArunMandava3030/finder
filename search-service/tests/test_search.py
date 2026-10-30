import threading
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app import SearchRequest, create_app, normalize_results, run_search
from search_batch import SearchBatch, run_batch


class SearchTests(unittest.TestCase):
    def test_health_does_not_contact_upstream(self):
        search = MagicMock()
        with TestClient(create_app(search)) as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["maxConcurrentSearches"], 2)
        search.assert_not_called()

    def test_validation_rejects_unbounded_or_unknown_inputs(self):
        search = MagicMock()
        invalid = [
            {"query": "a"}, {"query": "x" * 161}, {"query": "  "},
            {"query": "Gokarna", "max_results": 9},
            {"query": "Gokarna", "max_results": True},
            {"query": "Gokarna", "freshness": "yesterday"},
            {"query": "Gokarna", "source": "instagram"},
            {"query": "Gokarna", "proxy": "https://example.org"},
        ]
        with TestClient(create_app(search)) as client:
            for payload in invalid:
                with self.subTest(payload=payload):
                    self.assertEqual(client.post("/search", json=payload).status_code, 400)
        search.assert_not_called()

    def test_results_are_safe_deduplicated_and_never_called_reviews(self):
        rows = [
            {"title": "Unsafe", "href": "javascript:alert(1)", "body": "bad"},
            {"title": "Credentials", "href": "https://user:pass@example.org"},
            {"title": "<b>Coastal walk</b>", "href": "https://example.org/route?utm_source=x", "body": "A &amp; B"},
            {"title": "Duplicate", "href": "https://example.org/route#section"},
            {"title": "Discussion", "href": "https://www.reddit.com/r/travel/comments/123/", "body": "Advice", "date": "yesterday"},
        ]
        items = normalize_results(rows, SearchRequest(query="Gokarna"))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].title, "Coastal walk")
        self.assertEqual(items[0].text, "A & B")
        self.assertEqual(items[1].source, "reddit")
        for item in items:
            self.assertIsNone(item.publishedAt)
            self.assertFalse(item.isReview)
            self.assertEqual(item.type, "search_excerpt")

    def test_source_filter_rejects_lookalike_reddit_hosts(self):
        rows = [
            {"title": "Fake", "href": "https://reddit.com.evil.example/discussion"},
            {"title": "Real", "href": "https://old.reddit.com/r/travel/comments/123/"},
        ]
        items = normalize_results(rows, SearchRequest(query="Gokarna", source="reddit"))
        self.assertEqual([item.title for item in items], ["Real"])

    @patch("app.DDGS")
    def test_indian_region_and_supported_freshness_are_sent(self, ddgs):
        client = ddgs.return_value.__enter__.return_value
        client.text.return_value = []
        run_search(SearchRequest(query="Gokarna travel", source="reddit", freshness="month", max_results=6))
        ddgs.assert_called_once_with(timeout=10, verify=True)
        client.text.assert_called_once_with(
            "Gokarna travel site:reddit.com", region="in-en", safesearch="moderate",
            max_results=6, backend="duckduckgo,bing", timelimit="m",
        )

    @patch("app.DDGS")
    def test_any_freshness_omits_time_parameter(self, ddgs):
        run_search(SearchRequest(query="Gokarna", freshness="any"))
        kwargs = ddgs.return_value.__enter__.return_value.text.call_args.kwargs
        self.assertNotIn("timelimit", kwargs)

    def test_provider_errors_do_not_leak_internal_details(self):
        def fail(_payload):
            raise RuntimeError("secret-token-and-private-provider-details")
        with TestClient(create_app(fail)) as client:
            response = client.post("/search", json={"query": "Gokarna"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("secret-token", response.text)

    def test_timed_out_workers_still_hold_capacity_until_they_exit(self):
        gate = threading.Event()
        def block(_payload):
            gate.wait(2)
            return []
        try:
            with TestClient(create_app(block, request_timeout=0.02)) as client:
                self.assertEqual(client.post("/search", json={"query": "Gokarna"}).status_code, 504)
                self.assertEqual(client.post("/search", json={"query": "Hampi"}).status_code, 504)
                response = client.post("/search", json={"query": "Coorg"})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error"]["code"], "SEARCH_BUSY")
        finally:
            gate.set()

    def test_batch_scrubs_reddit_user_text_and_records_partial_failure(self):
        batch = SearchBatch.model_validate({"queries": [
            {"id": "gokarna", "query": "Gokarna", "source": "reddit", "freshness": "month"},
            {"id": "hampi", "query": "Hampi", "source": "web", "freshness": "any"},
        ], "max_results": 6})
        def search(payload):
            if payload.query == "Hampi":
                raise RuntimeError("internal-error")
            return [{"title": "A user's original Gokarna title", "href": "https://www.reddit.com/r/travel/comments/123/", "body": "A user's original text"}]
        pause = MagicMock()
        output = run_batch(batch, search, pause)
        pause.assert_called_once_with(1)
        self.assertEqual(output["validationVersion"], 2)
        self.assertIs(output["relevanceChecked"], True)
        self.assertEqual([result["status"] for result in output["results"]], ["ok", "error"])
        item = output["results"][0]["items"][0]
        self.assertEqual(item["title"], "Traveller discussion on Reddit")
        self.assertEqual(item["text"], "")
        self.assertIsNone(item["publishedAt"])
        self.assertNotIn("internal-error", str(output))

    def test_batch_rejects_duplicate_ids(self):
        with self.assertRaises(ValueError):
            SearchBatch.model_validate({"queries": [{"id": "same", "query": "Gokarna"}, {"id": "same", "query": "Hampi"}]})

    def test_batch_drops_irrelevant_search_engine_results(self):
        batch = SearchBatch.model_validate({"queries": [{"id": "gokarna", "query": "Gokarna India hidden places travel experience", "source": "reddit"}]})
        output = run_batch(batch, lambda _payload: [
            {"title": "Gaming discussion", "href": "https://www.reddit.com/r/gaming/comments/123/", "body": "Latest game review and travel experience tips"},
        ])
        self.assertEqual(output["results"][0]["status"], "empty")
        self.assertEqual(output["results"][0]["items"], [])

    def test_static_batch_only_retains_actual_reddit_threads(self):
        batch = SearchBatch.model_validate({"queries": [{"id": "gokarna", "query": "Gokarna", "source": "reddit"}]})
        output = run_batch(batch, lambda _payload: [
            {"title": "Gokarna business", "href": "https://business.reddit.com/r/travel/comments/123/"},
            {"title": "Gokarna subreddit", "href": "https://www.reddit.com/r/gokarna/"},
            {"title": "Gokarna promoted page", "href": "https://www.reddit.com/advertising/"},
            {"title": "Gokarna actual thread", "href": "https://old.reddit.com/r/india/comments/abc123/gokarna_trip/"},
        ])
        items = output["results"][0]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["url"], "https://old.reddit.com/r/india/comments/abc123/gokarna_trip/")


if __name__ == "__main__":
    unittest.main()
