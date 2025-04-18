import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { getVerificationLink, goToSignup, signupWith } from './utils'

const sentEmailChecker = new SentEmailChecker()

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test('sign up and verify email with different user', async ({ context, page }) => {
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=email-verification-notification]')

  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(1)
  const link = getVerificationLink(emails[0].templateVariables)
  expect(link).toBeDefined()

  await clearLocalState({ context, page })

  await loginPage.navigateTo()
  await loginPage.loginWith('admin', 'admin1234')
  await page.waitForSelector('[data-test=app-bar-user-button]')

  await page.goto(link!)

  await page.waitForSelector('[data-test=wrong-user-error]')
  await page.click('[data-test=switch-user-button]')

  await loginPage.loginWith(username, 'password123')

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})
