import { expect, test } from '@playwright/test'
import { suppressChangelog } from '../../changelog-utils'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { signupWith, VERIFICATION_LINK_REGEX } from './utils'

const sentEmailChecker = new SentEmailChecker()

test('sign up and verify email with different user', async ({ context, page }) => {
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
  const link = VERIFICATION_LINK_REGEX.exec(emails[0].text)?.groups?.link
  expect(link).toBeDefined()

  await context.clearCookies()
  await page.goto('/login')
  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[name="password"]', 'admin1234')
  await page.click('[data-test=submit-button]')
  await page.waitForSelector('[data-test=left-nav]')

  await page.goto(link!)

  await page.waitForSelector('[data-test=wrong-user-error]')
  await page.click('[data-test=switch-user-button]')

  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', 'password123')
  await page.click('[data-test=submit-button]')

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})
