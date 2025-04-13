import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

const sentEmailChecker = new SentEmailChecker()

test('recover username after signing up', async ({ context, page }) => {
  // Sign up with a new account
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await page.waitForSelector('[data-test=notifications-button]')

  // Clear local state to simulate a fresh session
  await clearLocalState({ context, page })
  await sentEmailChecker.resetEmailsFor(email)

  // Navigate to the username recovery page
  await page.goto('/recover-username')

  // Fill in the email address and submit the form
  await page.fill('input[name="email"]', email)
  await page.click('[data-test=submit-button]')

  // Wait for the success message
  await page.waitForSelector('[data-test=recover-username-success]')

  // Check the sent email for the recovered username
  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(1)
  const usernames = emails[0].templateVariables.usernames as Array<{ username: string }>
  expect(usernames).toEqual([{ username }])
})
