import { expect, test } from '@playwright/test'
import { suppressChangelog } from '../../changelog-utils'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { signupWith, VERIFICATION_LINK_REGEX } from './utils'

const sentEmailChecker = new SentEmailChecker()

test('wrong token -> resend -> first token -> second token', async ({ page }) => {
  // This test checks for regressions of a bug which caused a user to be in a session that was
  // stuck registering as "not verified" despite being verified in the DB. It ensures that
  // submitting tokens once an account is verified is a no-op but completes successfully.
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

  const linkUrl = new URL(link!)
  linkUrl.searchParams.set('token', 'wrong-token')
  const wrongTokenLink = linkUrl.toString()

  await page.goto(wrongTokenLink!)

  await page.waitForSelector('[data-test=invalid-code-error]')
  await page.click('[data-test=resend-email-button]')
  await page.waitForSelector('[data-test=email-resent-success]')

  await page.goto(link!)
  await page.waitForSelector('[data-test=continue-button]')

  // Successfully verified, grab the second token link now and re-verify
  const moreEmails = await sentEmailChecker.retrieveSentEmails(email)
  expect(moreEmails).toHaveLength(2)
  const secondLink = VERIFICATION_LINK_REGEX.exec(emails[0].text)?.groups?.link
  expect(secondLink).toBeDefined()

  await page.goto('/')
  await page.goto(secondLink!)

  await page.click('[data-test=continue-button]')
  await page.click('[data-test=notifications-button]')
  await page.waitForSelector('[data-test=notifications-clear-button]')

  await expect(page.locator('[data-test=email-verification-notification]')).toHaveCount(0)
})
