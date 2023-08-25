import { expect, test } from '@playwright/test'
import { suppressChangelog } from '../../changelog-utils'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { signupWith } from '../signup/utils'

const sentEmailChecker = new SentEmailChecker()
let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test('change password', async ({ context, page }) => {
  await page.goto('/signup')
  await suppressChangelog(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=email-verification-warning]')).toBeVisible()

  const beforeCount = (await sentEmailChecker.retrieveSentEmails(email)).length

  await page.click('[data-test=change-password-button]')

  await page.fill('input[name="currentPassword"]', 'wrong-password')
  await page.fill('input[name="newPassword"]', 'new-password')
  await page.fill('input[name="confirmNewPassword"]', 'new-password')

  await page.click(
    '[data-test=change-password-dialog] [data-test=dialog-actions] [data-test=save-button]',
  )

  // TODO(tec27): Would be nice to make this less dependent on exact content/translation
  await expect(
    page.locator('[data-test=validation-error]', { hasText: /current password is incorrect/i }),
  ).toBeVisible()

  await page.fill('input[name="currentPassword"]', 'password123')
  await page.click('[data-test=dialog-actions] [data-test=save-button]')

  await expect(page.locator('[data-test=change-password-dialog]')).toHaveCount(0)

  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(beforeCount + 1)
  const passwordChangeEmail = emails.filter(e => e.template === 'password-change')
  expect(passwordChangeEmail).toHaveLength(1)

  await context.clearCookies()
  await loginPage.navigateTo()
  await loginPage.loginWith(username, 'new-password')
  await page.waitForSelector('[data-test=left-nav]')
})
