import { Page } from '@playwright/test'

export async function suppressChangelog(page: Page): Promise<void> {
  await page.evaluate(() => {
    // TODO(tec27): Use the key from a common place, atm importing it breaks due to __WEBPACK_ENV
    // not being around
    window.localStorage.setItem('shieldBatteryVersion', '999999999999999.0.0')
  })
}
