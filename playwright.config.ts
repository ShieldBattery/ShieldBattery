import { devices, PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  testDir: './integration/tests',
  globalSetup: require.resolve('./integration/global-setup.ts'),

  forbidOnly: !!process.env.CI,
  // We can't really do retries because our database is shared between tests, so
  // e.g. signup tests will conflict with each other on created accounts
  retries: 0,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  use: {
    baseURL: 'http://localhost:5527',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
}

export default config
