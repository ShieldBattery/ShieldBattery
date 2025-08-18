import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { HomePage } from '../../pages/home-page'
import { RESTRICTED_TEST_NAME } from '../../test-constants'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

let homePage: HomePage

test.beforeEach(async ({ page }) => {
  homePage = new HomePage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('change display name successfully and verify it appears in settings and app bar', async ({
  page,
}) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const newDisplayName = generateUsername()
  const email = `${originalUsername}@example.org`

  await signupWith(page, {
    username: originalUsername,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Verify original name appears in app bar initially
  await expect(page.locator('[data-test="app-bar-user-button"]')).toContainText(originalUsername)

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // Click the edit display name button
  await page.click('[data-test=edit-display-name-button]')

  // Fill in the change display name form
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', newDisplayName)

  // Submit the form
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Verify dialog closes
  await expect(page.locator('[data-test=change-display-name-dialog]')).toHaveCount(0)

  // Verify the display name changed in the settings UI
  await expect(
    page.locator('text="Display name"').locator('..').locator(`text="${newDisplayName}"`),
  ).toBeVisible()

  // Close settings and verify the new display name appears in the app bar
  await page.click('[data-test=close-settings]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()
  await expect(page.locator('[data-test="app-bar-user-button"]')).toContainText(newDisplayName)
})

test('cannot change display name again within 60 days (rate limiting)', async ({ page }) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const secondDisplayName = generateUsername()
  const thirdDisplayName = generateUsername()
  const email = `${originalUsername}@example.org`

  await signupWith(page, {
    username: originalUsername,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // First change - should succeed
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', secondDisplayName)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )
  await expect(page.locator('[data-test=change-display-name-dialog]')).toHaveCount(0)

  // Try to change again immediately - should show cooldown message in dialog
  await page.click('[data-test=edit-display-name-button]')

  // Should see cooldown message in the dialog
  await expect(
    page
      .locator('[data-test=change-display-name-dialog]')
      .locator('text=/You can change your display name again in \\d+ day/'),
  ).toBeVisible()

  // Try to submit anyway - should get rate limited error
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', thirdDisplayName)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see rate limited error message
  await expect(
    page.locator('[data-test=change-display-name-dialog]', {
      hasText: 'You have changed your display name too recently',
    }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-display-name-dialog]')).toBeVisible()
})

test('cannot change display name to restricted name', async ({ page }) => {
  // Create a regular user
  await goToSignup(page)

  const originalUsername = generateUsername()
  const email = `${originalUsername}@example.org`

  await signupWith(page, {
    username: originalUsername,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // Try to change to the restricted name (set up in global setup)
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', RESTRICTED_TEST_NAME)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about display name not being available
  // Note: Check for any validation error first, then check the specific text
  await expect(page.locator('[data-test=validation-error]')).toBeVisible()

  // Check if it's the expected error text
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /not available|unavailable|taken/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-display-name-dialog]')).toBeVisible()
})

test('cannot change display name with wrong password', async ({ page }) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const newDisplayName = generateUsername()
  const email = `${originalUsername}@example.org`

  await signupWith(page, {
    username: originalUsername,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // Try to change with wrong password
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'wrongpassword')
  await page.fill('input[name="name"]', newDisplayName)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about current password being incorrect
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /current password is incorrect/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-display-name-dialog]')).toBeVisible()
})

test('cannot change display name to existing username', async ({ page }) => {
  // Create first user
  await goToSignup(page)
  const firstUsername = generateUsername()
  const firstEmail = `${firstUsername}@example.org`

  await signupWith(page, {
    username: firstUsername,
    password: 'password123',
    email: firstEmail,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')

  // Logout and create second user
  await clearLocalState({ context: page.context(), page })
  await goToSignup(page)
  const secondUsername = generateUsername()
  const secondEmail = `${secondUsername}@example.org`

  await signupWith(page, {
    username: secondUsername,
    password: 'password456',
    email: secondEmail,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // Try to change to the first user's username
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'password456')
  await page.fill('input[name="name"]', firstUsername)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about display name not being available
  // Note: Check for any validation error first, then check the specific text
  await expect(page.locator('[data-test=validation-error]')).toBeVisible()

  // Check if it's the expected error text
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /not available/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-display-name-dialog]')).toBeVisible()
})

test('capitalization-only changes are allowed without cooldown', async ({ page }) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const email = `${originalUsername}@example.org`

  await signupWith(page, {
    username: originalUsername,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Navigate to account settings
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toBeVisible()

  // First change to a completely different name
  const differentName = generateUsername() + 'a' // Add 'a' to ensure it's different when capitalized
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', differentName)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )
  await expect(page.locator('[data-test=change-display-name-dialog]')).toHaveCount(0)

  // Immediately try to change to capitalized version - should work despite cooldown
  const capitalizedName = differentName.toUpperCase()
  await page.click('[data-test=edit-display-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="name"]', capitalizedName)
  await page.click(
    '[data-test=change-display-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should succeed without rate limiting error
  await expect(page.locator('[data-test=change-display-name-dialog]')).toHaveCount(0)

  // Verify the display name changed to the capitalized version
  await expect(
    page.locator('text="Display name"').locator('..').locator(`text="${capitalizedName}"`),
  ).toBeVisible()
})
