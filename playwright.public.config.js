import { defineConfig } from '@playwright/test';
import sharedConfig from './playwright.config.js';

// Build first with VITE_BASE_PATH=/finder/ and VITE_SEARCH_MODE=public.
// Reuse the repository's Chromium/Edge selection and desktop/mobile projects.
export default defineConfig({
  ...sharedConfig,
  testMatch: 'public-ui.spec.js',
  outputDir: 'test-results/public',
  use: {
    ...sharedConfig.use,
    baseURL: 'http://127.0.0.1:4173/finder/',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/finder/',
    env: { VITE_BASE_PATH: '/finder/', VITE_SEARCH_MODE: 'public' },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
