import { expect, test } from '@playwright/test'
import { clearLocalState } from '../../clear-local-state'
import { EmailVerificationDialogPage } from '../../pages/email-verification-dialog-page'
import { HomePage } from '../../pages/home-page'
import { LoginPage } from '../../pages/login-page'
import { SentEmailChecker } from '../../sent-email-checker'
import { generateUsername } from '../../username-generator'
import { goToSignup, signupWith } from './utils'

const sentEmailChecker = new SentEmailChecker()

let loginPage: LoginPage
let homePage: HomePage
let verificationDialogPage: EmailVerificationDialogPage

test.beforeEach(async ({ page }) => {
  loginPage = new LoginPage(page)
  homePage = new HomePage(page)
  verificationDialogPage = new EmailVerificationDialogPage(page)
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('sign up and verify email in same session', async ({ page }) => {
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`

  await signupWith(page, {
    username,
    password: 'password123',
    email,
  })

  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  await page.click('[data-test=settings-button]')
  await page.click('[data-test=verify-email-button]')

  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(1)
  const { code } = emails[0].templateVariables
  expect(code).toBeDefined()

  await verificationDialogPage.verifyWithCode(code)
  await expect(page.locator('[data-test=verify-email-button]')).toHaveCount(0)
})

test('sign up and verify email on subsequent login', async ({ context, page }) => {
  await goToSignup(page)

  const username = generateUsername()
  const email = `${username}@example.org`
  const password = 'password123'

  await signupWith(page, {
    username,
    password,
    email,
  })

  // Should land on home page after signup
  await expect(homePage.latestNewsTitleLocator()).toBeVisible()

  // Log out
  await clearLocalState({ context, page })

  // Log in
  await loginPage.navigateTo()
  await loginPage.fillLoginForm(username, password)
  await loginPage.clickLogInButton()

  // EmailVerificationDialog should be visible
  await expect(verificationDialogPage.dialogLocator()).toBeVisible()

  // Retrieve the verification code from the sent email
  const emails = await sentEmailChecker.retrieveSentEmails(email)
  expect(emails).toHaveLength(1)
  const { code } = emails[0].templateVariables
  expect(code).toBeDefined()

  // Enter the code and verify
  await verificationDialogPage.verifyWithCode(code)
  await expect(verificationDialogPage.dialogLocator()).toHaveCount(0)

  // Check that the verify email button is gone (user is now verified)
  await page.click('[data-test=settings-button]')
  await expect(page.locator('[data-test=verify-email-button]')).toHaveCount(0)
})
