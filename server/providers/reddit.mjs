import { createHash } from 'node:crypto';

export const INDIA_TRAVEL_SUBREDDITS = Object.freeze(['IndiaTravel', 'IndiaTripPlanning', 'SoloTravel_India']);
const ALLOWED_SUBREDDITS = new Set(INDIA_TRAVEL_SUBREDDITS.map((name) => name.toLowerCase()));
const statesByFetch = new WeakMap();
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function abortError() {
  return new DOMException('Discussion collection cancelled.', 'AbortError');
}

function clean(value, limit = 2000) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit);
}

function words(value) {
  return (value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => !['a', 'an', 'the', 'in', 'near', 'of', 'to', 'for', 'and'].includes(word));
}

function configuration(env) {
  const clientId = env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = env.REDDIT_USER_AGENT?.trim();
  if (!clientId || !clientSecret || !userAgent || /[\r\n]/.test(userAgent) || userAgent.length > 512) return null;
  return { clientId, clientSecret, userAgent };
}

function providerState(fetchImpl, config) {
  let states = statesByFetch.get(fetchImpl);
  if (!states) { states = new Map(); statesByFetch.set(fetchImpl, states); }
  const key = createHash('sha256').update(`${config.clientId}\0${config.clientSecret}\0${config.userAgent}`).digest('hex');
  if (!states.has(key)) {
    if (states.size >= 4) states.delete(states.keys().next().value);
    states.set(key, { token: null, tokenExpiresAt: 0, blockedUntil: 0 });
  }
  return states.get(key);
}

async function readJson(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new Error('Response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

async function requestJson(url, options, { fetchImpl, signal, timeoutMs, state, now }) {
  if (signal.aborted) throw abortError();
  if (state.blockedUntil > now()) throw failure('REDDIT_RATE_LIMITED', 'Reddit is rate limiting this app. Discussion refresh will be available after a pause.');
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(failure('REDDIT_TIMEOUT', 'Reddit took too long to respond. Please try again later.'));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (response.status === 429 || (remaining !== null && Number(remaining) <= 0)) {
      const seconds = Number(response.headers.get('retry-after')) || Number(response.headers.get('x-ratelimit-reset')) || 60;
      state.blockedUntil = now() + Math.min(3600, Math.max(1, seconds)) * 1000;
    }
    if (response.status === 429) throw failure('REDDIT_RATE_LIMITED', 'Reddit is rate limiting this app. Discussion refresh will be available after a pause.');
    if ([401, 403].includes(response.status)) {
      state.token = null;
      state.tokenExpiresAt = 0;
      throw failure('REDDIT_ACCESS_DENIED', 'Reddit denied API access. Check the app approval and server credentials.');
    }
    if (!response.ok) throw failure('REDDIT_UNAVAILABLE', 'Reddit discussions are unavailable right now.');
    const data = await readJson(response);
    if (data?.error || data?.errors) throw failure('REDDIT_UNAVAILABLE', 'Reddit could not complete this request.');
    return data;
  })();
  try {
    return await Promise.race([request, interrupted]);
  } catch (error) {
    controller.abort();
    if (signal.aborted) throw abortError();
    if (typeof error.code === 'string' && error.code.startsWith('REDDIT_')) throw error;
    throw failure('REDDIT_UNAVAILABLE', 'Could not retrieve Reddit discussions. Try again later.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function removed(data, text) {
  return data.over_18 || data.quarantine || data.removed_by_category || data.banned_by
    || data.subreddit_type === 'private' || ['[deleted]', '[removed]'].includes(data.author)
    || ['[deleted]', '[removed]'].includes(String(text || '').trim().toLowerCase())
    || String(data.author).toLowerCase() === 'automoderator';
}

function publishedAt(data, now, maxAgeDays) {
  if (typeof data.created_utc !== 'number' || !Number.isFinite(data.created_utc)) return null;
  const timestamp = data.created_utc * 1000;
  if (timestamp <= 0 || timestamp > now() + 300_000 || timestamp < now() - maxAgeDays * 86_400_000) return null;
  return new Date(timestamp).toISOString();
}

function itemUrl(data, postId) {
  if (!/^[a-z0-9]+$/i.test(postId) || !/^[a-z0-9]+$/i.test(data.id || '') || !ALLOWED_SUBREDDITS.has(String(data.subreddit).toLowerCase())) return null;
  try {
    const fallback = `/r/${data.subreddit}/comments/${postId}/${data.id === postId ? '' : `_/${data.id}/`}`;
    const url = new URL(data.permalink || fallback, 'https://www.reddit.com');
    if (url.protocol !== 'https:' || !['www.reddit.com', 'reddit.com'].includes(url.hostname) || url.username || url.password) return null;
    const match = url.pathname.match(/^\/r\/([a-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/|$)/i);
    if (!match || match[1].toLowerCase() !== data.subreddit.toLowerCase() || match[2] !== postId) return null;
    if (data.id !== postId && url.pathname.split('/').filter(Boolean)[5] !== data.id) return null;
    url.hostname = 'www.reddit.com';
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}

function toItem(data, type, context, options) {
  if (!data || typeof data !== 'object') return null;
  const text = type === 'comment' ? data.body : data.selftext;
  if (removed(data, text)) return null;
  const date = publishedAt(data, options.now, options.maxAgeDays);
  if (!date) return null;
  const postId = type === 'discussion' ? data.id : context.id;
  if (type === 'comment' && (data.link_id && data.link_id !== `t3_${postId}`)) return null;
  if (type === 'comment' && data.subreddit?.toLowerCase() !== context.subreddit.toLowerCase()) return null;
  const url = itemUrl(data, postId);
  if (!url || (type === 'comment' && !clean(text))) return null;
  const title = type === 'discussion' ? clean(data.title, 300) : `Comment on: ${clean(context.title, 280)}`;
  if (!title || ['[deleted]', '[removed]'].includes(title.toLowerCase())) return null;
  const author = typeof data.author === 'string' && /^[a-z0-9_-]{2,30}$/i.test(data.author) ? data.author : null;
  return {
    id: `reddit:${type === 'discussion' ? 't3' : 't1'}_${data.id}`,
    type,
    title,
    text: clean(text),
    url,
    publishedAt: date,
    retrievedAt: new Date(options.now()).toISOString(),
    ...(author ? { author } : {}),
    ...(typeof data.score === 'number' && Number.isFinite(data.score) ? { score: Math.trunc(data.score) } : {}),
    subreddit: data.subreddit,
    source: 'reddit',
    isReview: false,
  };
}

/** Fetch current discussion excerpts. Do not persist these as a permanent review dataset. */
export async function fetchRedditEvidence(query, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 12_000,
  totalTimeoutMs = 35_000,
  maxThreads = 3,
  commentsPerThread = 5,
  maxAgeDays = 365,
  now = Date.now,
} = {}) {
  if (signal?.aborted) throw abortError();
  const config = configuration(env);
  if (!config) return {
    items: [], status: 'not_configured',
    warnings: ['Fresh Reddit discussions require an approved Reddit app and REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT on the server.'],
  };
  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 160 || !words(query).length) {
    return { items: [], status: 'unavailable', warnings: ['Provide a place and city query between 2 and 160 characters.'] };
  }
  const threadCap = Math.min(3, Math.max(1, Math.floor(Number(maxThreads) || 3)));
  const commentCap = Math.min(5, Math.max(0, Math.floor(Number(commentsPerThread) || 0)));
  const age = Math.min(365, Math.max(1, Number(maxAgeDays) || 365));
  const state = providerState(fetchImpl, config);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(60_000, Math.max(1, Number(totalTimeoutMs) || 35_000)));
  const requestOptions = { fetchImpl, signal: controller.signal, timeoutMs: Math.min(20_000, Math.max(1, Number(timeoutMs) || 12_000)), state, now };
  const warnings = ['Reddit posts and comments are individual discussions, not verified visitor reviews or ratings. Dates show when each item was posted.'];
  const itemOptions = { now, maxAgeDays: age };
  const items = [];
  try {
    if (!state.token || state.tokenExpiresAt <= now()) {
      const token = await requestJson('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'User-Agent': config.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      }, requestOptions);
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 4096
        || !/^bearer$/i.test(token.token_type || '')) throw failure('REDDIT_ACCESS_DENIED', 'Reddit did not issue an application access token. Check app approval and credentials.');
      state.token = token.access_token;
      state.tokenExpiresAt = now() + Math.max(0, Math.min(86_400, Number(token.expires_in) || 3600) - 60) * 1000;
    }
    const headers = { Authorization: `Bearer ${state.token}`, 'User-Agent': config.userAgent, Accept: 'application/json' };
    const search = new URL(`https://oauth.reddit.com/r/${INDIA_TRAVEL_SUBREDDITS.join('+')}/search`);
    for (const [key, value] of Object.entries({ q: query.trim(), restrict_sr: 'true', sort: 'new', t: 'year', limit: '25', raw_json: '1', include_over_18: 'false' })) search.searchParams.set(key, value);
    const listing = await requestJson(search.href, { headers }, requestOptions);
    if (!Array.isArray(listing?.data?.children)) throw failure('REDDIT_UNAVAILABLE', 'Reddit returned an unexpected discussion response.');
    const queryWords = [...new Set(words(query))];
    const seen = new Set();
    const posts = listing.data.children.slice(0, 25)
      .filter((entry) => entry?.kind === 't3')
      .map((entry) => entry.data)
      .filter((post) => {
        const item = toItem(post, 'discussion', null, itemOptions);
        if (!item || seen.has(item.id)) return false;
        const textWords = new Set(words(`${post.title} ${post.selftext || ''}`));
        if (!queryWords.every((word) => textWords.has(word))) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => b.created_utc - a.created_utc)
      .slice(0, threadCap);
    items.push(...posts.map((post) => toItem(post, 'discussion', null, itemOptions)));
    for (const post of posts) {
      if (!commentCap) break;
      try {
        const commentsUrl = new URL(`https://oauth.reddit.com/comments/${post.id}`);
        for (const [key, value] of Object.entries({ sort: 'top', limit: String(commentCap * 2), depth: '1', raw_json: '1', showmore: 'false' })) commentsUrl.searchParams.set(key, value);
        const thread = await requestJson(commentsUrl.href, { headers }, requestOptions);
        if (!Array.isArray(thread) || !Array.isArray(thread[1]?.data?.children)) throw failure('REDDIT_UNAVAILABLE', 'The comment thread could not be loaded.');
        const currentPost = thread[0]?.data?.children?.find((entry) => entry.kind === 't3' && entry.data?.id === post.id)?.data;
        const currentItem = currentPost && toItem(currentPost, 'discussion', null, itemOptions);
        const currentWords = currentPost ? new Set(words(`${currentPost.title} ${currentPost.selftext || ''}`)) : new Set();
        if (!currentItem || !queryWords.every((word) => currentWords.has(word))) {
          const index = items.findIndex((item) => item.id === `reddit:t3_${post.id}`);
          if (index !== -1) items.splice(index, 1);
          continue;
        }
        const postIndex = items.findIndex((item) => item.id === currentItem.id);
        if (postIndex !== -1) items[postIndex] = currentItem;
        const comments = thread[1].data.children.slice(0, commentCap * 2)
          .filter((entry) => entry?.kind === 't1')
          .map((entry) => toItem(entry.data, 'comment', currentPost, itemOptions))
          .filter((item) => item && !seen.has(item.id) && seen.add(item.id))
          .slice(0, commentCap);
        items.push(...comments);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        warnings.push('Some comment threads could not be refreshed. Available discussion excerpts are shown.');
        if (timedOut || ['REDDIT_RATE_LIMITED', 'REDDIT_ACCESS_DENIED'].includes(error.code)) break;
      }
    }
    if (signal?.aborted) throw abortError();
    return { items, warnings, status: 'ok' };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return {
      items: [], status: 'unavailable',
      warnings: [timedOut ? 'Reddit discussion refresh timed out. Please try again later.'
        : typeof error.code === 'string' && error.code.startsWith('REDDIT_') ? error.message : 'Reddit discussions could not be refreshed. Please try again later.'],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
