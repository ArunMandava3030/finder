import test from 'node:test';
import assert from 'node:assert/strict';
import { retainEarlierDiscussionLinks } from '../server/discovery/discussions.mjs';

test('empty or failed searches retain recent link observations with unchanged dates, and expire old ones', () => {
  const items = [
    { destinationId: 'gokarna', url: 'https://www.reddit.com/r/travel/comments/abc/a/', retrievedAt: '2026-10-29T00:00:00Z', publishedAt: '2026-10-01' },
    { destinationId: 'gokarna', url: 'https://www.reddit.com/r/travel/comments/def/b/', retrievedAt: '2026-08-01T00:00:00Z' },
    { destinationId: 'gokarna', url: 'https://www.reddit.com/r/travel/comments/ghi/c/', retrievedAt: 'invalid' },
    { destinationId: 'hampi', url: 'https://www.reddit.com/r/travel/comments/jkl/d/', retrievedAt: '2026-10-28T00:00:00Z' },
  ];
  const retained = retainEarlierDiscussionLinks(items, 'gokarna', Date.parse('2026-10-30T00:00:00Z'));
  assert.deepEqual(retained, [{ ...items[0], stale: true }, items[3]]);
  assert.equal(items[0].stale, undefined);
});
