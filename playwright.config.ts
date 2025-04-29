import { devices, PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  testDir: './integration/',
  reporter: process.env.CI ? 'github' : 'list',

  forbidOnly: !!process.env.CI,
  // We can't really do retries because our database is shared between tests, so
  // e.g. signup tests will conflict with each other on created accounts
  retries: 0,

  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: '**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  use: {
    baseURL: 'http://localhost:5527',
    headless: true,
    viewport: { width: 1366, height: 768 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
}

export default config
