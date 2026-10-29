import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSearchService, SearchError } from './search.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ service = createSearchService(), now = Date.now, rateLimit = 20, windowMs = 60_000 } = {}) {
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

  app.get('/api/search', async (req, res) => {
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
      return res.status(429).json({
        ...service.status(), results: [], warnings: [],
        error: { code: 'RATE_LIMITED', message: 'You have made several searches. Please wait a minute and try again.' },
      });
    }
    client.count += 1;
    clients.set(ip, client);
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
