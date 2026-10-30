import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSearchService, SearchError } from './search.mjs';
import { createDiscoveryEngine } from './discovery/engine.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ service = createSearchService(), engine = createDiscoveryEngine(), now = Date.now, rateLimit = 20, windowMs = 60_000, discoveryRequestTimeoutMs = 65_000, evidenceRequestTimeoutMs = 50_000 } = {}) {
  const app = express();
  const clients = new Map();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, search: service.status() });
  });

  function allowRequest(req, res, search = false) {
    res.setHeader('Cache-Control', 'no-store');
    const timestamp = now();
    const ip = req.ip || 'unknown';
    if (clients.size >= 5000) {
      for (const [key, item] of clients) if (item.resetAt <= timestamp) clients.delete(key);
    }
    let client = clients.get(ip);
    if (!client || client.resetAt <= timestamp) {
      client = { count: 0, resetAt: timestamp + windowMs };
    }
    if (client.count >= rateLimit || (!clients.has(ip) && clients.size >= 5000)) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((client.resetAt - timestamp) / 1000)));
      res.status(429).json({
        ...(search ? { ...service.status(), results: [], warnings: [] } : {}),
        error: { code: 'RATE_LIMITED', message: 'You have made several searches. Please wait a minute and try again.' },
      });
      return false;
    }
    client.count += 1;
    clients.set(ip, client);
    return true;
  }

  app.get('/api/search', async (req, res) => {
    if (!allowRequest(req, res, true)) return;
    try {
      const result = await service.search(req.query.q, { source: req.query.source || 'all' });
      return res.status(result.configured ? 200 : 503).json(result);
    } catch (error) {
      const known = error instanceof SearchError;
      return res.status(known ? error.status : 500).json({
        ...service.status(),
        query: typeof req.query.q === 'string' ? req.query.q.slice(0, 160) : '',
        results: [], warnings: [], retrievedAt: new Date(now()).toISOString(),
        error: { code: known ? error.code : 'SEARCH_ERROR', message: known ? error.message : 'Search could not be completed. Please try again.' },
      });
    }
  });

  app.get('/api/destinations', (req, res) => {
    if (!allowRequest(req, res)) return;
    res.json({ destinations: engine.destinations, total: engine.destinations.length });
  });

  const knownErrors = {
    INVALID_QUERY: [400, 'Enter a destination or place query between 3 and 160 characters.'],
    UNKNOWN_DESTINATION: [400, 'Choose one of the supported India destinations.'],
    DISCOVERY_BUSY: [503, 'Place collection is busy. Try again shortly.'],
    DISCOVERY_UNAVAILABLE: [502, 'Place data providers are unavailable. Try again later.'],
    DISCOVERY_TIMEOUT: [504, 'Place collection timed out. Try again later.'],
    EVIDENCE_BUSY: [503, 'Discussion searches are busy. Try again shortly.'],
    EVIDENCE_TIMEOUT: [504, 'Discussion search timed out. Try again later.'],
  };

  function discoveryRoute(kind, timeoutMs) {
    return async (req, res) => {
      if (!allowRequest(req, res)) return;
      const controller = new AbortController();
      const onClose = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', onClose);
      let timer;
      try {
        if (typeof req.query.q !== 'string' || req.query.q.trim().length < 3 || req.query.q.length > 160) throw Object.assign(new Error('Invalid query'), { code: 'INVALID_QUERY' });
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(Object.assign(new Error('Request timed out'), { code: kind === 'discover' ? 'DISCOVERY_TIMEOUT' : 'EVIDENCE_TIMEOUT' }));
            controller.abort();
          }, Math.max(1, Math.min(Number(timeoutMs) || 65_000, 90_000)));
        });
        const result = await Promise.race([engine[kind](req.query.q, { signal: controller.signal }), timeout]);
        if (kind === 'evidence' && result.providers?.every(provider => !['ok', 'partial'].includes(provider.status))) {
          const missing = result.providers.every(provider => provider.status === 'not_configured');
          return res.status(missing ? 503 : 502).json({ ...result, error: {
            code: missing ? 'EVIDENCE_NOT_CONFIGURED' : 'EVIDENCE_UNAVAILABLE',
            message: missing ? 'Discussion sources are not connected to this server.' : 'Discussion sources could not be reached. Try again later.',
          } });
        }
        return res.json(result);
      } catch (error) {
        if (res.destroyed) return;
        const known = knownErrors[error.code];
        if (known?.[0] === 503) res.setHeader('Retry-After', '5');
        return res.status(known?.[0] || 500).json({ error: {
          code: known ? error.code : 'DISCOVERY_ERROR',
          message: known?.[1] || 'The request could not be completed. Try again later.',
        } });
      } finally {
        clearTimeout(timer);
        res.removeListener('close', onClose);
      }
    };
  }

  app.get('/api/discover', discoveryRoute('discover', discoveryRequestTimeoutMs));
  app.get('/api/evidence', discoveryRoute('evidence', evidenceRequestTimeoutMs));

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }));
  const dist = path.join(projectRoot, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const app = createApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`Finder API listening on http://localhost:${port}`);
  });
}
