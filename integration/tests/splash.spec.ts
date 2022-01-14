import { expect, test } from '@playwright/test'

test('shows splash page', async ({ page }) => {
  await page.goto('/')
  const signUpButton = page.locator('[data-test=sign-up-button]')
  await expect(signUpButton).toBeVisible()
})
