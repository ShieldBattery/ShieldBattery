import { expect, test } from '@playwright/test'
import { clearLocalState } from '../clear-local-state'
import { EmailVerificationDialogPage } from '../pages/email-verification-dialog-page'
import { LoginPage } from '../pages/login-page'
import { generateUsername } from '../username-generator'
import { goToSignup } from './signup/utils'

let loginPage: LoginPage

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'admin1234'

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('restricted names block signup', async ({ context, page }) => {
  await new EmailVerificationDialogPage(page).suppressEmailVerificationDialog()

  // 1) Log into the admin account
  await loginPage.navigateTo()
  await loginPage.fillLoginForm(ADMIN_USERNAME, ADMIN_PASSWORD)
  await loginPage.clickLogInButton()
  await page.waitForSelector('[data-test=app-bar-user-button]')

  // 2) Navigate to the Restricted Names admin page
  await page.goto('/admin/restricted-names')

  // 3) Generate 2 random usernames
  const name1 = generateUsername()
  const name2 = generateUsername()

  // 4) Add a restricted name for an exact match on the first name
  await page.fill('input[name="pattern"]', name1)
  await page.click('input[name="kind"][value="EXACT"]')
  await page.click('[data-test=add-restricted-name-button]')
  await page.waitForSelector('[data-test=added-confirmation]')

  // 5) Add a restricted name for a pattern match on the second name being the full string
  await page.fill('input[name="pattern"]', `^${name2}$`)
  await page.click('input[name="kind"][value="REGEX"]')
  await page.click('[data-test=add-restricted-name-button]')
  await page.waitForSelector('[data-test=added-confirmation]')

  await page.click('[data-test=refresh-restricted-names-button]')
  await page.waitForSelector(`[data-test=restricted-name-row][data-pattern="${name1}" i]`)
  await page.waitForSelector(`[data-test=restricted-name-row][data-pattern="^${name2}$" i]`)

  // 6) Log out and go to the signup page
  await clearLocalState({ context, page })
  await goToSignup(page)

  // 7) Check that putting in the first name is disallowed because it is restricted
  await page.fill('input[name="username"]', name1)
  await page.fill('input[name="email"]', `${name1}@example.org`)
  await page.fill('input[name="password"]', 'password123')
  await page.fill('input[name="confirmPassword"]', 'password123')
  await page.check('input[name="ageConfirmation"]')
  await page.check('input[name="policyAgreement"]', { position: { x: 4, y: 4 } })
  await page.click('[data-test=submit-button]')
  // TODO(tec27): Would be nice to make this less dependent on exact content/translation
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /username is not available/i }),
  ).toBeVisible()

  // 8) Check that putting in the second name is disallowed because it is restricted
  await page.reload()
  await page.fill('input[name="username"]', name2)
  await page.fill('input[name="email"]', `${name2}@example.org`)
  await page.fill('input[name="password"]', 'password123')
  await page.fill('input[name="confirmPassword"]', 'password123')
  await page.check('input[name="ageConfirmation"]')
  await page.check('input[name="policyAgreement"]', { position: { x: 4, y: 4 } })
  await page.click('[data-test=submit-button]')
  // TODO(tec27): Would be nice to make this less dependent on exact content/translation
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /username is not available/i }),
  ).toBeVisible()

  await page.fill('input[name="username"]', name2 + 'x')
  await expect(page.locator('[data-test=validation-error]')).toHaveCount(0)
})
