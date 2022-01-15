import { expect, Page, test } from '@playwright/test'
import { suppressChangelog } from '../changelog-utils'
import { SentEmailChecker } from '../sent-email-checker'

const sentEmailChecker = new SentEmailChecker()

async function signupWith(
  page: Page,
  { username, email, password }: { username: string; email: string; password: string },
) {
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.fill('input[name="confirmPassword"]', password)
  await page.check('input[name="ageConfirmation"]')
  // NOTE(tec27): This one needs a position because otherwise it falls on a link and opens a
  // dialog
  await page.check('input[name="policyAgreement"]', { position: { x: 4, y: 4 } })
  await page.click('[data-test=submit-button]')
}

const VERIFICATION_LINK_REGEX = /Verify email \( (?<link>\S+) \)/

test('sign up and verify email in same browser', async ({ page }) => {
  await page.goto('/signup')
  await suppressChangelog(page)

  await signupWith(page, {
    username: 'SignupSpec-0',
    password: 'password123',
    email: 'signupspec-0@example.org',
  })

  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=email-verification-notification]')

  const emails = await sentEmailChecker.retrieveSentEmails('signupspec-0@example.org')
  expect(emails).toHaveLength(1)
  const link = VERIFICATION_LINK_REGEX.exec(emails[0].text)?.groups?.link
  expect(link).toBeDefined()

  await page.goto(link!)

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})
