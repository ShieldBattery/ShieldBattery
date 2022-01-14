import { devices, PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  testDir: './integration/tests',

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  use: {
    baseURL: 'http://127.0.0.1:5527',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
}

export default config
