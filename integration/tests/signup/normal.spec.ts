import { expect, test } from '@playwright/test'
import { suppressChangelog } from '../../changelog-utils'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { getVerificationLink, signupWith } from './utils'

const sentEmailChecker = new SentEmailChecker()

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
})

test('sign up and verify email in same browser', async ({ page }) => {
  await page.goto('/signup')
  await suppressChangelog(page)

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

  await page.goto(link!)

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})

test('sign up and verify email in different browser', async ({ context, page }) => {
  await page.goto('/signup')
  await suppressChangelog(page)

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

  await context.clearCookies()
  await page.goto(link!)

  await page.waitForSelector('[data-test=not-logged-in-error]')
  await page.click('[data-test=log-in-button]')

  await loginPage.loginWith(username, 'password123')

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})
