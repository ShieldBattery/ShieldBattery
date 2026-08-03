import { expect, test } from '@playwright/test'
import { UserSettingsPage } from '../../../client/settings/settings-page'
import { TranslationLanguage } from '../../../common/i18n'
import { clearLocalState } from '../../clear-local-state'
import { EmailVerificationDialogPage } from '../../pages/email-verification-dialog-page'
import { HomePage } from '../../pages/home-page'
import { LoginPage } from '../../pages/login-page'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

let loginPage: LoginPage
let homePage: HomePage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  homePage = new HomePage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('change language for logged out user and verify it persists', async ({ page }) => {
  // Navigate to the app (logged out state)
  await page.goto('/')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Open settings
  await page.click('[data-testid=settings-button]')

  // Navigate to language settings (should be the default page for logged out users)
  await expect(page.locator(`[data-testid=${UserSettingsPage.Language}-nav-entry]`)).toBeVisible()

  // Verify we're on the language settings page
  await expect(page.locator(`[data-testid=${TranslationLanguage.English}-button]`)).toBeVisible()

  // Check that English is initially selected (default language)
  const englishRadio = page.locator(`[data-testid=${TranslationLanguage.English}-button]`)
  await expect(englishRadio).toBeChecked()

  // Change language to Spanish
  const spanishRadio = page.locator(`[data-testid=${TranslationLanguage.Spanish}-button]`)
  await spanishRadio.click()

  // Wait for the change to be applied (debounced dispatch + translation bundle load): i18next
  // stamps the body when it completes, and the settings form snapshots the current language when
  // it mounts, so reopening before this point would show the old language.
  await expect(page.locator('body')).toHaveAttribute('data-lang', TranslationLanguage.Spanish, {
    timeout: 10000,
  })

  // Verify Spanish is now selected
  await expect(spanishRadio).toBeChecked()
  await expect(englishRadio).not.toBeChecked()

  // Reopen settings to verify the language selection persisted
  await page.click('[data-testid=close-settings]')
  await page.click('[data-testid=settings-button]')
  await expect(spanishRadio).toBeChecked()
  await expect(englishRadio).not.toBeChecked()
})

test('change language for logged in user and verify it persists', async ({ context, page }) => {
  // Create a user account
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-testid=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Open settings
  await page.click('[data-testid=settings-button]')

  // Navigate to language settings
  await page.click(`[data-testid=${UserSettingsPage.Language}-nav-entry]`)
  await expect(page.locator(`[data-testid=${TranslationLanguage.English}-button]`)).toBeVisible()

  // Check that English is initially selected (default language)
  const englishRadio = page.locator(`[data-testid=${TranslationLanguage.English}-button]`)
  await expect(englishRadio).toBeChecked()

  // Change language to Korean
  const koreanRadio = page.locator(`[data-testid=${TranslationLanguage.Korean}-button]`)
  await koreanRadio.click()

  // Wait for the change to be applied (debounced dispatch + server request + translation bundle
  // load): i18next stamps the body when it completes, and the settings form snapshots the current
  // language when it mounts, so reopening before this point would show the old language.
  await expect(page.locator('body')).toHaveAttribute('data-lang', TranslationLanguage.Korean, {
    timeout: 10000,
  })

  // Verify Korean is now selected
  await expect(koreanRadio).toBeChecked()
  await expect(englishRadio).not.toBeChecked()

  // Close settings and verify the language change is reflected in the UI
  await page.click('[data-testid=close-settings]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Reopen settings to verify the language selection persisted
  await page.click('[data-testid=settings-button]')
  await page.click(`[data-testid=${UserSettingsPage.Language}-nav-entry]`)
  await expect(koreanRadio).toBeChecked()
  await expect(englishRadio).not.toBeChecked()

  // Test that the language persists after logout and login
  await page.click('[data-testid=close-settings]')

  // Logout
  await clearLocalState({ context, page })

  // Login again. The dialog suppression must be in place before the login response arrives,
  // since the flag only prevents the dialog from opening -- it can't close it.
  await loginPage.navigateTo()
  await new EmailVerificationDialogPage(page).suppressEmailVerificationDialog()
  await loginPage.loginWith(username, 'password123')

  // Verify we're logged in
  await page.waitForSelector('[data-testid=app-bar-user-button]')
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // The session's locale is applied asynchronously after login; wait for it before opening the
  // settings form, which snapshots the current language when it mounts.
  await expect(page.locator('body')).toHaveAttribute('data-lang', TranslationLanguage.Korean, {
    timeout: 10000,
  })

  // Verify language setting persisted
  await page.click('[data-testid=settings-button]')
  await page.click(`[data-testid=${UserSettingsPage.Language}-nav-entry]`)
  await expect(koreanRadio).toBeChecked()
  await expect(englishRadio).not.toBeChecked()
})
