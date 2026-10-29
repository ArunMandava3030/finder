import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const localBrowsers = fileURLToPath(new URL('./.local/ms-playwright/', import.meta.url));
const localChromium = process.platform === 'win32' && existsSync(localBrowsers)
  ? readdirSync(localBrowsers)
    .filter(name => /^chromium-\d+$/.test(name))
    .map(name => path.join(localBrowsers, name, 'chrome-win64', 'chrome.exe'))
    .find(existsSync)
  : undefined;

const hasEdge = process.platform === 'win32' && [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].some(existsSync);
const useLocalChromium = localChromium && !process.env.PLAYWRIGHT_CHANNEL;
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || (!useLocalChromium && hasEdge ? 'msedge' : undefined);

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui.spec.js',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    browserName: 'chromium',
    ...(browserChannel ? { channel: browserChannel } : {}),
    launchOptions: { timeout: 30_000, ...(useLocalChromium ? { executablePath: localChromium } : {}) },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3001/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
