import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { EmailVerificationDialogPage } from '../../pages/email-verification-dialog-page'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from '../signup/utils'

const sentEmailChecker = new SentEmailChecker()

let loginPage: LoginPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)

  await new EmailVerificationDialogPage(page).suppressEmailVerificationDialog()
})

test('password reset flow', async ({ context, page }) => {
  // Step 1: Sign up with a new account
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`
  const password = 'password123'

  await signupWith(page, {
    username,
    password,
    email,
  })
  await page.waitForSelector('[data-test=notifications-button]')

  // Step 2: Log out
  await clearLocalState({ context, page })
  await sentEmailChecker.resetEmailsFor(email)

  // Step 3: Use the "Forgot password" feature
  await page.goto('/forgot-password')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="username"]', username)
  await page.click('[data-test=submit-button]')
  await page.waitForSelector('[data-test=reset-password-form]')

  // Step 4: Check the sent emails to retrieve the code
  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(1)
  const resetCode = emails[0].templateVariables.code
  expect(resetCode).toBeDefined()

  const newPassword = 'newpassword123'
  // Step 5: Enter an incorrect code to test the error message
  await page.fill('input[name="code"]', '33333-33333')
  await page.fill('input[name="password"]', newPassword)
  await page.fill('input[name="confirmPassword"]', newPassword)
  await page.click('[data-test=submit-button]')
  await page.waitForSelector('[data-test=errors-container] [data-test=invalid-code-text]')

  // Step 6: Enter the correct code
  await page.fill('input[name="code"]', resetCode)
  await page.fill('input[name="password"]', newPassword)
  await page.fill('input[name="confirmPassword"]', newPassword)
  await page.click('[data-test=submit-button]')

  await page.click('[data-test=continue-to-login]')

  // Step 7: Log in with the new password
  await loginPage.loginWith(username, newPassword)
  await page.waitForSelector('[data-test=notifications-button]')
})
