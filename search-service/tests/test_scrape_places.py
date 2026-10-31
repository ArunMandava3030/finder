import unittest
from unittest.mock import MagicMock, patch

from scrape_places import Document, collect, extract_places, fetch_document, public_url, robots_policy, validate_sources

DESTINATION = {'id': 'wayanad', 'city': 'Wayanad', 'state': 'Kerala', 'bbox': [11.4, 75.7, 12.0, 76.5]}
SOURCE = {'id': 'wayanad-official', 'destinationId': 'wayanad', 'url': 'https://tourism.example.org/places/', 'publisher': 'District Tourism', 'parser': 'listing', 'scope': 'destination', 'itemSelector': '.place', 'nameSelector': 'h3', 'linkSelector': 'a', 'linkPattern': '^/place/', 'maxPlaces': 60}
MANIFEST = {'schemaVersion': 1, 'sources': [SOURCE]}
FETCHED = '2026-10-31T05:00:00Z'
HTML = b'''<html><nav><h3>Newsletter</h3></nav><main>
<article class="place"><h3>Phantom Rock</h3><p>A long copyrighted description and made-up review stars must not be copied.</p><a href="/place/phantom-rock/">Details</a></article>
<article class="place"><h3>Phantom Rock</h3><a href="/place/phantom-rock/">Duplicate</a></article>
<article class="place"><h3>Private Estate</h3><p>No public access</p><a href="/place/private/">Details</a></article>
<article class="place"><h3>Unrelated place</h3><a href="https://other.example.org/places/a/">Elsewhere</a></article>
<article class="place"><h3>Contact us</h3><a href="/contact/">Contact</a></article>
</main></html>'''


class ScrapePlacesTests(unittest.TestCase):
    def test_scrapling_extracts_only_scoped_named_places_and_keeps_factual_attribution(self):
        places = extract_places(HTML, SOURCE, DESTINATION, FETCHED)
        self.assertEqual([place['name'] for place in places], ['Phantom Rock'])
        place = places[0]
        self.assertEqual(place['sources'][0]['url'], 'https://tourism.example.org/place/phantom-rock/')
        self.assertEqual(place['sources'][0]['retrievedAt'], FETCHED)
        self.assertEqual(place['sources'][0]['excerpt'], '')
        self.assertNotIn('copyrighted', str(place))
        self.assertNotIn('rating', place)
        self.assertIsNone(place['coordinates'])
        self.assertEqual(place['category'], 'Nature')
        self.assertEqual(place['id'], extract_places(HTML, SOURCE, DESTINATION, FETCHED)[0]['id'])

    def test_region_wide_catalog_requires_and_applies_destination_allowlist(self):
        source = {**SOURCE, 'scope': 'region', 'allowedNames': ['Phantom Rock']}
        self.assertEqual(len(extract_places(HTML, source, DESTINATION, FETCHED)), 1)
        self.assertEqual(extract_places(HTML, {**source, 'allowedNames': ['Different Rock']}, DESTINATION, FETCHED), [])
        with self.assertRaises(ValueError):
            validate_sources({'schemaVersion': 1, 'sources': [{**SOURCE, 'scope': 'region'}]}, [DESTINATION])

    def test_attribute_selector_keeps_detail_links_and_applies_path_allowlist(self):
        source = {**SOURCE, 'itemSelector': 'h2 a', 'nameSelector': None, 'linkSelector': '::attr(href)', 'allowedPaths': ['/place/lake/']}
        places = extract_places(b'<h2><a href="/place/lake/">Test Lake</a></h2><h2><a href="/place/elsewhere/">Other Lake</a></h2>', source, DESTINATION, FETCHED)
        self.assertEqual([place['name'] for place in places], ['Test Lake'])
        self.assertEqual(places[0]['sources'][0]['url'], 'https://tourism.example.org/place/lake/')

    def test_plain_headings_share_the_catalog_url_but_have_distinct_ids(self):
        source = {**SOURCE, 'itemSelector': 'main h3', 'nameSelector': None, 'linkSelector': None, 'linkPattern': None}
        places = extract_places(b'<main><h3>Lake One</h3><h3>Lake Two</h3></main>', source, DESTINATION, FETCHED)
        self.assertEqual(len(places), 2)
        self.assertNotEqual(places[0]['id'], places[1]['id'])
        self.assertEqual(places[0]['sources'][0]['url'], SOURCE['url'])

    def test_detail_coordinates_must_belong_to_this_place_and_destination(self):
        source = {**SOURCE, 'parser': 'detail', 'itemSelector': 'h1', 'nameSelector': None, 'linkSelector': None, 'linkPattern': None}
        page = '<h1>Test Lake</h1><script type="application/ld+json">{"@type":"TouristAttraction","name":"Test Lake","geo":{"latitude":11.7,"longitude":76.1}}</script>'
        self.assertEqual(extract_places(page.encode(), source, DESTINATION, FETCHED)[0]['coordinates'], {'lat': 11.7, 'lng': 76.1})
        self.assertEqual(extract_places(page.replace('11.7', '28.7').encode(), source, DESTINATION, FETCHED), [])
        self.assertIsNone(extract_places(page.replace('"name":"Test Lake"', '"name":"Tourist Office"').encode(), source, DESTINATION, FETCHED)[0]['coordinates'])

    def test_robots_supports_wildcards_end_anchors_specific_groups_and_allow_ties(self):
        body = b'User-agent: *\nDisallow: /places/*\nAllow: /places/open$\nCrawl-delay: 2\n'
        self.assertEqual(robots_policy(body, 'https://tourism.example.org/places/closed'), (False, 2))
        self.assertTrue(robots_policy(body, 'https://tourism.example.org/places/open')[0])
        self.assertFalse(robots_policy(body, 'https://tourism.example.org/places/open/extra')[0])
        specific = body + b'\nUser-agent: ElsewhereBot\nAllow: /places/\n'
        self.assertTrue(robots_policy(specific, 'https://tourism.example.org/places/closed')[0])
        with self.assertRaises(ValueError):
            robots_policy(b'<html>Not crawler rules</html>', SOURCE['url'])

    def test_disallowed_source_is_never_fetched_and_robots_failure_is_not_empty_success(self):
        fetch = MagicMock(return_value=Document(200, b'User-agent: *\nDisallow: /places/'))
        result = collect(MANIFEST, [DESTINATION], fetch=fetch, pause=lambda _: None)
        self.assertEqual(result['sources'][0]['status'], 'blocked')
        self.assertEqual(fetch.call_count, 1)
        fetch = MagicMock(return_value=Document(503, b''))
        result = collect(MANIFEST, [DESTINATION], fetch=fetch, pause=lambda _: None)
        self.assertEqual(result['sources'][0]['status'], 'unavailable')
        self.assertIsNone(result['sources'][0]['fetchedAt'])
        self.assertEqual(fetch.call_count, 1)

    def test_collection_caches_robots_per_origin_and_distinguishes_layout_change_and_rate_limit(self):
        source2 = {**SOURCE, 'id': 'second', 'url': 'https://tourism.example.org/more/'}
        fetch = MagicMock(side_effect=[Document(204, b''), Document(200, HTML, 'text/html'), Document(429, b'')])
        pauses = []
        result = collect({'schemaVersion': 1, 'sources': [SOURCE, source2]}, [DESTINATION], fetch=fetch, pause=pauses.append)
        self.assertEqual([source['status'] for source in result['sources']], ['ok', 'blocked'])
        self.assertEqual(fetch.call_count, 3)
        self.assertTrue(all(delay >= 1.5 for delay in pauses))
        empty = collect(MANIFEST, [DESTINATION], fetch=MagicMock(side_effect=[Document(404, b''), Document(200, b'<main>Changed</main>', 'text/html')]), pause=lambda _: None)
        self.assertEqual(empty['sources'][0]['status'], 'empty')
        self.assertEqual(empty['sources'][0]['places'], [])

    def test_transport_rejects_redirects_and_oversized_responses(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.headers = {'Content-Length': '2097153'}
        with patch('scrape_places.build_opener') as opener:
            opener.return_value.open.return_value = response
            with self.assertRaises(ValueError):
                fetch_document(SOURCE['url'])
            response.read.assert_not_called()
            response.status = 302
            self.assertEqual(fetch_document(SOURCE['url']).status, 302)
        self.assertIsNone(public_url('https://127.0.0.1/'))
        self.assertIsNone(public_url('https://user:password@example.org/'))
        self.assertIsNone(public_url('javascript:alert(1)'))

    def test_changed_layout_excess_and_unregistered_sources_fail_explicitly(self):
        with self.assertRaises(ValueError):
            extract_places(b'<main>' + b'<h3>A place</h3>' * 301 + b'</main>', {**SOURCE, 'itemSelector': 'h3'}, DESTINATION, FETCHED)
        with self.assertRaises(ValueError):
            collect(MANIFEST, [DESTINATION], only={'unregistered'}, fetch=MagicMock(), pause=lambda _: None)

    def test_slow_body_is_checked_between_single_reads(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.headers = {}
        response.read1.return_value = b'x'
        with patch('scrape_places.build_opener') as opener, patch('scrape_places.time.monotonic', side_effect=[0, 0, 13]):
            opener.return_value.open.return_value = response
            with self.assertRaises(TimeoutError):
                fetch_document(SOURCE['url'])
        response.read1.assert_called_once()
        response.read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
