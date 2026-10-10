import { defineConfig, devices } from '@playwright/test';

// One browser run over the synthetic fixtures (spec §9): the demo API never touches the network.
const apiPort = '3101';
const webPort = '5174';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: [
    {
      command: 'pnpm --filter @scrapjob/api demo',
      env: { PORT: apiPort },
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @scrapjob/web exec vite --port ${webPort}`,
      env: { PORT: apiPort },
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
