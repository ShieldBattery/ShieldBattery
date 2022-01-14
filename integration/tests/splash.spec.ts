import { expect, test } from '@playwright/test'

test('shows splash page', async ({ page }) => {
  await page.goto('/')
  const somethingThatWillFail = page.locator('.definitely-not-there')
  await expect(somethingThatWillFail).toHaveText('Hello World')
})
