import { chromium, FullConfig } from '@playwright/test'

export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(baseURL!)
  await page.click('[data-test=sign-up-button]')

  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[name="email"]', 'admin@example.org')
  await page.fill('input[name="password"]', 'admin1234')
  await page.fill('input[name="confirmPassword"]', 'admin1234')
  await page.check('input[name="ageConfirmation"]')
  // NOTE(tec27): This one needs a position because otherwise it falls on a link and opens a
  // dialog
  await page.check('input[name="policyAgreement"]', { position: { x: 4, y: 4 } })
  await page.click('[data-test=submit-button]')

  await page.waitForSelector('[data-test=left-nav]')

  await browser.close()
}
