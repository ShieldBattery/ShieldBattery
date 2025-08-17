import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { HomePage } from '../../pages/home-page'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { RESTRICTED_TEST_NAME } from '../../test-constants'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

const sentEmailChecker = new SentEmailChecker()
let loginPage: LoginPage
let homePage: HomePage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  homePage = new HomePage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('change login name successfully, logout, login with new name, verify email sent', async ({
  context,
  page,
}) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const newUsername = generateUsername()
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

  const beforeCount = (await sentEmailChecker.retrieveSentEmails(email)).length

  // Click the edit login name button
  await page.click('[data-test=edit-login-name-button]')

  // Fill in the change login name form
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="loginName"]', newUsername)

  // Submit the form
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Verify dialog closes
  await expect(page.locator('[data-test=change-login-name-dialog]')).toHaveCount(0)

  // Verify the login name changed in the UI by checking the text near the edit button
  await expect(
    page.locator('text="Login name"').locator('..').locator(`text="${newUsername}"`),
  ).toBeVisible()

  // Check that a login name change email was sent
  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(beforeCount + 1)
  const loginNameChangeEmail = emails.filter(e => e.template === 'login-name-change')
  expect(loginNameChangeEmail).toHaveLength(1)
  expect(loginNameChangeEmail[0].templateVariables.oldLoginName).toBe(originalUsername)
  expect(loginNameChangeEmail[0].templateVariables.newLoginName).toBe(newUsername)

  // Logout and login with new username
  await clearLocalState({ context, page })
  await loginPage.navigateTo()
  await loginPage.loginWith(newUsername, 'password123')
  await page.waitForSelector('[data-test=app-bar-user-button]')

  // Verify we successfully logged in
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()
})

test('cannot change login name again within 30 days (rate limiting)', async ({ page }) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const secondUsername = generateUsername()
  const thirdUsername = generateUsername()
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
  await page.click('[data-test=edit-login-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="loginName"]', secondUsername)
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )
  await expect(page.locator('[data-test=change-login-name-dialog]')).toHaveCount(0)

  // Try to change again immediately - should show cooldown message in dialog
  await page.click('[data-test=edit-login-name-button]')

  // Should see cooldown message in the dialog
  await expect(
    page
      .locator('[data-test=change-login-name-dialog]')
      .locator('text=/You can change your login name again in \\d+ day/'),
  ).toBeVisible()

  // Try to submit anyway - should get rate limited error
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="loginName"]', thirdUsername)
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see rate limited error message
  await expect(
    page
      .locator('[data-test=change-login-name-dialog]')
      .locator('text=/You can only change your login name once every 30 days/'),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-login-name-dialog]')).toBeVisible()
})

test('cannot change login name to restricted name', async ({ page }) => {
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
  await page.click('[data-test=edit-login-name-button]')
  await page.fill('input[name="currentPassword"]', 'password123')
  await page.fill('input[name="loginName"]', RESTRICTED_TEST_NAME)
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about login name not being available
  // Note: Check for any validation error first, then check the specific text
  await expect(page.locator('[data-test=validation-error]')).toBeVisible()

  // Check if it's the expected error text
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /not available|unavailable|taken/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-login-name-dialog]')).toBeVisible()
})

test('cannot change login name with wrong password', async ({ page }) => {
  await goToSignup(page)

  const originalUsername = generateUsername()
  const newUsername = generateUsername()
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
  await page.click('[data-test=edit-login-name-button]')
  await page.fill('input[name="currentPassword"]', 'wrongpassword')
  await page.fill('input[name="loginName"]', newUsername)
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about current password being incorrect
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /current password is incorrect/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-login-name-dialog]')).toBeVisible()
})

test('cannot change login name to existing username', async ({ page }) => {
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
  await page.click('[data-test=edit-login-name-button]')
  await page.fill('input[name="currentPassword"]', 'password456')
  await page.fill('input[name="loginName"]', firstUsername)
  await page.click(
    '[data-test=change-login-name-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // Should see an error about login name not being available
  // Note: Check for any validation error first, then check the specific text
  await expect(page.locator('[data-test=validation-error]')).toBeVisible()

  // Check if it's the expected error text
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /not available/i }),
  ).toBeVisible()

  // Dialog should remain open
  await expect(page.locator('[data-test=change-login-name-dialog]')).toBeVisible()
})
