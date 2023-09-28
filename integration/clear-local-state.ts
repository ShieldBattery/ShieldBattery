import { BrowserContext, Page } from '@playwright/test'

// TODO(tec27): Do this by using the logout function directly instead? This was just more expedient
// at the moment
/** Clears local state for a browser/page (so that it will be logged out.) */
export async function clearLocalState({ context, page }: { context: BrowserContext; page: Page }) {
  // TODO(tec27): Remove this after the migration cookie is removed
  await context.clearCookies()

  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.sessionStorage.clear())
}
